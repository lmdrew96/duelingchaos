package dev.duelingchaos.bridge;

import forge.LobbyPlayer;
import forge.deck.CardPool;
import forge.game.GameEntityView;
import forge.game.GameState;
import forge.game.GameView;
import forge.game.card.CardFaceView;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
import forge.game.spellability.StackItemView;
import forge.gamemodes.match.AbstractGuiGame;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.player.PlayerZoneUpdate;
import forge.player.PlayerZoneUpdates;
import forge.trackable.TrackableCollection;
import forge.util.FSerializableFunction;
import forge.util.ITriggerEvent;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.TimeUnit;

// AbstractGuiGame (the same base Forge's own desktop/mobile GUIs extend)
// already implements most of IGuiGame's plumbing — state tracking, zone
// updates, etc. What's left below is the actual "ask a human something"
// surface: dialogs, choices, targeting. Every real decision (targeting,
// modes, X-cost, mana payment, combat damage, confirm/option dialogs,
// generic amount-splitting) now routes through the PendingChoice +
// SynchronousQueue rendezvous below instead of a hardcoded default —
// the callback blocks the forge-game-thread, exposes the choice via
// getPendingChoice(), and a generic HTTP endpoint resolves it. The only
// deliberate holdout is showInputDialog's non-numeric branch (free-text
// input isn't a shape any card in scope needs yet).
public class BridgeGuiGame extends AbstractGuiGame {

    // Surfaces what Forge is waiting on for the human seat so the frontend
    // can render it instead of the game silently hanging — e.g. the
    // opening-hand mulligan choice routes through updateButtons' two
    // generic dialog buttons plus a showPromptMessage description, not
    // through confirm()/showConfirmDialog() (those stay auto-answered,
    // see the class-level comment below).
    private volatile String promptMessage;
    private volatile String button1Label;
    private volatile String button2Label;
    private volatile boolean button1Enabled;
    private volatile boolean button2Enabled;
    private volatile boolean isMulliganPrompt;

    public String getPromptMessage() { return promptMessage; }
    public boolean isMulliganPrompt() { return isMulliganPrompt; }
    public String getButton1Label() { return button1Label; }
    public String getButton2Label() { return button2Label; }
    public boolean isButton1Enabled() { return button1Enabled; }
    public boolean isButton2Enabled() { return button2Enabled; }

    // Generic "block the forge-game-thread and ask the human" mechanism.
    // Every real-choice callback (targeting, modal spells, mana payment,
    // X-cost, combat damage) shares this one shape: stash a description of
    // the choice where GameStateJson can see it, then rendezvous on
    // choiceAnswer until an HTTP action resolves it. Forge calls these
    // synchronously from its own dedicated game thread (see BridgeMain),
    // so blocking here doesn't touch the HTTP dispatch thread.
    public static final class PendingChoice {
        public final String kind;
        public final String title;
        public final List<String> options;
        public final int min;
        public final int max;
        public final boolean optional;
        public final String initialInput;
        public final String attacker;
        // Shared by "combatDamage" (total combat damage) and "splitAmount"
        // (any other Forge-driven "split N across these targets" prompt,
        // e.g. assignGenericAmount) — same split-a-total-across-inputs UI.
        public final int amount;
        // "card:<id>" / "player:<id>" refs parallel to options — lets the
        // frontend match a target choice to the actual rendered card/player
        // tile (by stable Forge id) instead of a display-string guess, so it
        // can highlight the real element and draw a targeting arrow to it.
        public final List<String> refs;
        // Best-effort arrow origin: the top-of-stack item's source card at
        // the moment a target/targets choice is raised. Forge's target
        // callbacks don't pass a source, but target declaration happens
        // immediately after a spell/ability is pushed to the stack, so the
        // top of stack is normally the thing asking for the target.
        public final String sourceRef;

        private PendingChoice(String kind, String title, List<String> options, int min, int max,
                boolean optional, String initialInput, String attacker, int amount,
                List<String> refs, String sourceRef) {
            this.kind = kind;
            this.title = title;
            this.options = options;
            this.min = min;
            this.max = max;
            this.optional = optional;
            this.initialInput = initialInput;
            this.attacker = attacker;
            this.amount = amount;
            this.refs = refs;
            this.sourceRef = sourceRef;
        }

        static PendingChoice list(String title, List<String> options, int min, int max) {
            return new PendingChoice("list", title, options, min, max, false, null, null, 0, null, null);
        }

        static PendingChoice target(String title, List<String> options, List<String> refs, String sourceRef, boolean optional) {
            return new PendingChoice("target", title, options, optional ? 0 : 1, 1, optional, null, null, 0, refs, sourceRef);
        }

        static PendingChoice targets(String title, List<String> options, List<String> refs, String sourceRef, int min, int max) {
            return new PendingChoice("targets", title, options, min, max, min == 0, null, null, 0, refs, sourceRef);
        }

        static PendingChoice number(String title, String initialInput) {
            return new PendingChoice("number", title, null, 0, 0, false, initialInput, null, 0, null, null);
        }

        static PendingChoice combatDamage(String attacker, List<String> blockerLabels, int damage) {
            return new PendingChoice("combatDamage", "Assign combat damage", blockerLabels, 0, 0, false, null, attacker, damage, null, null);
        }

        // atLeastOne mirrors Forge's own constraint (e.g. Fling-style effects
        // that must put at least 1 on every chosen target) — reuses
        // `optional` the same way `number`'s min does: true means a target
        // may legally end up at 0.
        static PendingChoice splitAmount(String title, List<String> targetLabels, int amount, boolean atLeastOne) {
            return new PendingChoice("splitAmount", title, targetLabels, atLeastOne ? 1 : 0, 0, !atLeastOne, null, null, amount, null, null);
        }
    }

    private volatile PendingChoice pendingChoice;
    private final SynchronousQueue<String> choiceAnswer = new SynchronousQueue<>();

    public PendingChoice getPendingChoice() { return pendingChoice; }

    // Called from the HTTP dispatch thread. Bounded wait rather than put()
    // so a stale/mistimed resolve request can never hang the single-threaded
    // HTTP server (see BridgeMain — setExecutor(null) means one request at a
    // time for the whole bridge, /state included).
    public boolean resolveChoice(String answer) {
        if (pendingChoice == null) return false;
        try {
            return choiceAnswer.offer(answer, 5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private String awaitChoiceAnswer() {
        try {
            return choiceAnswer.take();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "";
        }
    }

    private static List<Integer> parseIndices(String answer) {
        List<Integer> result = new ArrayList<>();
        for (String part : answer.split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) continue;
            try {
                result.add(Integer.parseInt(trimmed));
            } catch (NumberFormatException ignored) {
                // malformed index — skip rather than crash the game thread
            }
        }
        return result;
    }

    private static String entityLabel(GameEntityView e) {
        if (e instanceof CardView) {
            CardView c = (CardView) e;
            return c.getCurrentState().getName() + (c.isTapped() ? " (tapped)" : "");
        }
        if (e instanceof PlayerView) {
            return ((PlayerView) e).getLobbyPlayerName();
        }
        return String.valueOf(e);
    }

    private static String entityRef(GameEntityView e) {
        if (e instanceof CardView) return "card:" + e.getId();
        if (e instanceof PlayerView) return "player:" + e.getId();
        return null;
    }

    private String peekStackSourceRef() {
        GameView gv = getGameView();
        if (gv == null) return null;
        Iterator<StackItemView> it = gv.getStack().iterator();
        if (!it.hasNext()) return null;
        CardView src = it.next().getSourceCard();
        return src == null ? null : "card:" + src.getId();
    }

    @Override
    protected void updateCurrentPlayer(PlayerView player) {
        // no-op: single fixed perspective, nothing to switch
    }

    @Override
    public boolean isUiSetToSkipPhase(PlayerView player, PhaseType phase) {
        return false;
    }

    @Override
    public void restoreOldZones(PlayerView player, PlayerZoneUpdates zonesToRestore) {
    }

    @Override
    public void message(String message, String title) {
        System.out.println("[gui] " + title + ": " + message);
    }

    // Scry/surveil's multi-card path is the main thing this drives (verified
    // via bytecode inspection of PlayerControllerHuman.arrangeForScry/
    // arrangeForSurveil — no source jar matched the shipped 2.0.13-SNAPSHOT
    // build, see forge-integration-technique): both call the 5-arg
    // IGuiGame.many(title, top, -1, choices, referenceCard) to pick the
    // bottom/graveyard pile, which cascades through two default-method
    // overloads down to this same abstract order() with min=max=-1 and
    // destChoices=null; separately, the 4-arg order() (used to arrange the
    // kept-on-top cards) cascades here with min=max=0. Forge uses that sign
    // as the only signal distinguishing the two shapes: -1 means "choose an
    // optional subset" (many/scry-bottom/surveil-graveyard — the caller
    // takes the ENTIRE returned list as the moved pile, so 0 picks is a
    // legal choice), 0 means "must place every card" (a forced full
    // permutation for the reorder-only case). Single-card scry/surveil
    // never reaches here — Forge special-cases size==1 via
    // InputConfirm.confirm, which already routes through the
    // updateButtons/showPromptMessage plumbing above (same mechanism as the
    // already-working mulligan Keep/Mulligan prompt).
    @Override
    public <T> IGuiGame.OrderResult<T> order(String title, String top, int min, int max,
            List<T> sourceChoices, List<T> destChoices, CardView referenceCard, boolean sideboardingMode, boolean isFreeform) {
        if (sourceChoices.size() <= 1) {
            return new IGuiGame.OrderResult<>(new ArrayList<>(sourceChoices), false);
        }
        List<String> labels = new ArrayList<>();
        for (T c : sourceChoices) {
            labels.add(c instanceof CardView ? entityLabel((CardView) c) : String.valueOf(c));
        }
        boolean optionalSubset = min < 0;
        int selMin = optionalSubset ? 0 : sourceChoices.size();
        int selMax = sourceChoices.size();
        pendingChoice = PendingChoice.list(title, labels, selMin, selMax);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<T> result = new ArrayList<>();
        for (int idx : parseIndices(answer)) {
            if (idx >= 0 && idx < sourceChoices.size()) result.add(sourceChoices.get(idx));
        }
        if (result.size() < selMin) {
            // malformed/short answer — fall back to the old deterministic
            // default rather than hand Forge a choice that violates its own
            // min-count contract
            return new IGuiGame.OrderResult<>(new ArrayList<>(sourceChoices), false);
        }
        return new IGuiGame.OrderResult<>(result, false);
    }

    @Override
    public void updateButtons(PlayerView owner, String label1, String label2, boolean enable1, boolean enable2, boolean focus1) {
        button1Label = label1;
        button2Label = label2;
        button1Enabled = enable1;
        button2Enabled = enable2;
        // GameView.isMulligan()/updateIsMulligan() looked like the natural
        // signal but only covers the London-rule "choose how many cards to
        // bottom" sub-step (verified via bytecode: only
        // InputLondonMulligan calls updateIsMulligan — InputConfirmMulligan,
        // which drives the actual "Do you want to keep your hand?" Keep/
        // Mulligan decision, never does). InputConfirmMulligan.showMessage()
        // does call updateButtons with the localizer-resolved "Keep"/
        // "Mulligan" labels directly (also verified via bytecode), so that
        // exact pair is the only reliable signal available without deeper
        // Input-class plumbing.
        isMulliganPrompt = "Keep".equals(label1) && "Mulligan".equals(label2);
    }

    // IGuiGame's own default for this 4-arg overload (verified via bytecode)
    // cascades into the 6-arg getChoices below with display=null — which
    // that method's null-display branch treats as "no way to label the
    // options," silently returning zero picks rather than prompting. That
    // default is why oneOrNone() (used by, among others, every
    // IDevModeCheats method: setPlayerLife's player picker, addCardToHand's
    // card-name picker) always no-ops today. Supplying a real display
    // function here instead — GameEntityView via the existing entityLabel()
    // helper, CardFaceView (the "Name the card" cheat picker) via getName(),
    // anything else via toString() — makes those prompts actually render.
    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices) {
        return getChoices(message, min, max, choices, null, BridgeGuiGame::describeChoice);
    }

    private static <T> String describeChoice(T item) {
        if (item instanceof GameEntityView) return entityLabel((GameEntityView) item);
        if (item instanceof CardFaceView) return ((CardFaceView) item).getName();
        return String.valueOf(item);
    }

    // Generic list-choice hook. Forge reuses this for several distinct
    // human decisions — modal spells ("choose one/two —"), and (confirmed
    // via reflection: AbstractGuiGame has no dedicated mana-color/source
    // hook) ambiguous mana payment too. Both resolve identically: pick
    // indices from the displayed list.
    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices, List<T> selected, FSerializableFunction<T, String> display) {
        if (choices.isEmpty()) {
            return new ArrayList<>();
        }
        if (choices.size() <= Math.max(min, 0) || display == null) {
            // no real freedom, or (e.g. AbstractGuiGame.reveal()'s
            // "here's what the AI skipped" informational reveal) no way to
            // label the options for a human — fall back to the old
            // deterministic default rather than crash on a null display fn.
            int count = Math.max(min, 0);
            return new ArrayList<>(choices.subList(0, Math.min(count, choices.size())));
        }
        List<String> labels = new ArrayList<>();
        for (T c : choices) labels.add(display.apply(c));
        pendingChoice = PendingChoice.list(message, labels, Math.max(min, 0), max <= 0 ? choices.size() : max);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<T> result = new ArrayList<>();
        for (int idx : parseIndices(answer)) {
            if (idx >= 0 && idx < choices.size()) result.add(choices.get(idx));
        }
        if (result.size() < Math.max(min, 0)) {
            result.clear();
            result.addAll(choices.subList(0, Math.min(Math.max(min, 0), choices.size())));
        }
        return result;
    }

    @Override
    public boolean confirm(CardView c, String question, boolean defaultIsYes, List<String> options) {
        // `options` here is Forge's own extra reminder-text lines shown
        // alongside the question (not alternate buttons) — folded into the
        // title so the human sees them, while the actual decision stays a
        // real yes/no pick either way.
        String title = (options == null || options.isEmpty())
            ? question
            : question + "\n" + String.join("\n", options);
        pendingChoice = PendingChoice.list(title, java.util.Arrays.asList("Yes", "No"), 1, 1);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> indices = parseIndices(answer);
        return indices.isEmpty() ? defaultIsYes : indices.get(0) == 0;
    }

    @Override
    public void openView(TrackableCollection<PlayerView> myPlayers) {
    }

    @Override
    public void showCombat() {
    }

    @Override
    public void alertUser() {
    }

    @Override
    public void enableOverlay() {
    }

    @Override
    public void disableOverlay() {
    }

    @Override
    public void finishGame() {
    }

    @Override
    public void showManaPool(PlayerView player) {
    }

    @Override
    public void hideManaPool(PlayerView player) {
    }

    @Override
    public Iterable<PlayerZoneUpdate> tempShowZones(PlayerView controller, Iterable<PlayerZoneUpdate> zonesToUpdate) {
        return zonesToUpdate;
    }

    @Override
    public void hideZones(PlayerView controller, Iterable<PlayerZoneUpdate> zonesToUpdate) {
    }

    @Override
    public GameState getGamestate() {
        return null;
    }

    @Override
    public void updateShards(Iterable<PlayerView> players) {
    }

    // Forge's real sideboarding UI (offer the sideboard pool, let the player
    // swap cards in/out) only makes sense between games of a multi-game
    // match, and BridgeMain runs exactly one match.createGame()/startGame()
    // per process — every match here is a single game, so this is never
    // actually reached in the current architecture. Declining the swap and
    // keeping the main deck as-is is the correct, safe behavior for that —
    // NOT a stand-in that silently drops player intent, since there's no
    // player-facing sideboard UI in this client to have expressed any.
    // Building a real swap prompt would need a best-of-3 match loop first
    // (see the "Sideboarding support" ChaosPatch scoping decision).
    @Override
    public List<PaperCard> sideboard(CardPool sideboard, CardPool main, String message) {
        return new ArrayList<>(main.toFlatList());
    }

    @Override
    public void setCard(CardView card) {
    }

    @Override
    public PlayerZoneUpdates openZones(PlayerView controller, Collection<forge.game.zone.ZoneType> zones, Map<PlayerView, Object> players, boolean backupLastZones) {
        return new PlayerZoneUpdates();
    }

    @Override
    public GameEntityView chooseSingleEntityForEffect(String title, List<? extends GameEntityView> optionList, DelayedReveal delayedReveal, boolean isOptional) {
        if (optionList.isEmpty()) {
            return null;
        }
        if (optionList.size() == 1 && !isOptional) {
            return optionList.get(0);
        }
        List<String> labels = new ArrayList<>();
        List<String> refs = new ArrayList<>();
        for (GameEntityView e : optionList) {
            labels.add(entityLabel(e));
            refs.add(entityRef(e));
        }
        pendingChoice = PendingChoice.target(title, labels, refs, peekStackSourceRef(), isOptional);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> indices = parseIndices(answer);
        if (indices.isEmpty()) {
            return isOptional ? null : optionList.get(0);
        }
        int idx = indices.get(0);
        return (idx >= 0 && idx < optionList.size()) ? optionList.get(idx) : optionList.get(0);
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList, int min, int max, DelayedReveal delayedReveal) {
        if (optionList.isEmpty()) {
            return new ArrayList<>();
        }
        List<String> labels = new ArrayList<>();
        List<String> refs = new ArrayList<>();
        for (GameEntityView e : optionList) {
            labels.add(entityLabel(e));
            refs.add(entityRef(e));
        }
        pendingChoice = PendingChoice.targets(title, labels, refs, peekStackSourceRef(), min, max);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<GameEntityView> result = new ArrayList<>();
        for (int idx : parseIndices(answer)) {
            if (idx >= 0 && idx < optionList.size()) result.add(optionList.get(idx));
        }
        if (result.size() < Math.max(min, 0)) {
            // fall back to the old deterministic default rather than hand
            // Forge a choice that violates its own min-count contract
            result.clear();
            for (int i = 0; i < min && i < optionList.size(); i++) result.add(optionList.get(i));
        }
        return result;
    }

    @Override
    public void showErrorDialog(String message, String title) {
        System.err.println("[gui error] " + title + ": " + message);
    }

    @Override
    public boolean showConfirmDialog(String message, String title, String yesButtonText, String noButtonText, boolean defaultIsYes) {
        String yes = (yesButtonText == null || yesButtonText.isEmpty()) ? "Yes" : yesButtonText;
        String no = (noButtonText == null || noButtonText.isEmpty()) ? "No" : noButtonText;
        pendingChoice = PendingChoice.list(message, java.util.Arrays.asList(yes, no), 1, 1);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> indices = parseIndices(answer);
        return indices.isEmpty() ? defaultIsYes : indices.get(0) == 0;
    }

    @Override
    public void showPromptMessage(PlayerView player, String message, CardView referenceCard) {
        System.out.println("[gui prompt] " + player + ": " + message);
        promptMessage = stripRedundantYouPrefix(message);
    }

    // Forge's own prompt text already opens with the player's name (e.g.
    // "You, you have won the coin toss."). Since the human seat is
    // literally named "You" (see BridgeMain — also what the board HUD shows
    // next to the life total), that reads as a stutter. Strip the redundant
    // prefix here rather than renaming the seat.
    private static String stripRedundantYouPrefix(String message) {
        if (!message.startsWith("You, ")) return message;
        String rest = message.substring(5);
        return rest.isEmpty() ? rest : Character.toUpperCase(rest.charAt(0)) + rest.substring(1);
    }

    @Override
    public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) {
        if (!isNumeric) {
            // non-numeric free-text input isn't part of this patch's scope
            // (X-costs are the confirmed numeric case) — keep the old
            // deterministic default here rather than guessing at a shape.
            return initialInput;
        }
        pendingChoice = PendingChoice.number(message, initialInput);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        return answer.isEmpty() ? initialInput : answer;
    }

    @Override
    public void flashIncorrectAction() {
    }

    @Override
    public void setPanelSelection(CardView hostCard) {
    }

    // Reached whenever a single click on a card resolves to more than one
    // playable SpellAbility — MDFCs (front vs back face), Adventure cards
    // (cast the Adventure vs the creature), cycling lands (play as land vs
    // cycle), cards offering both a cast and an activated-ability option.
    // Same "pick one of N" shape as getChoices/order above, just forced to
    // exactly one pick since playing more than one ability from one click
    // isn't a legal outcome.
    @Override
    public SpellAbilityView getAbilityToPlay(CardView hostCard, List<SpellAbilityView> abilities, ITriggerEvent triggerEvent) {
        if (abilities.isEmpty()) {
            return null;
        }
        if (abilities.size() == 1) {
            return abilities.get(0);
        }
        List<String> labels = new ArrayList<>();
        for (SpellAbilityView a : abilities) labels.add(a.getDescription());
        pendingChoice = PendingChoice.list("Choose ability", labels, 1, 1);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        for (int idx : parseIndices(answer)) {
            if (idx >= 0 && idx < abilities.size()) return abilities.get(idx);
        }
        return abilities.get(0);
    }

    @Override
    public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage, GameEntityView defender, boolean overrideOrder, boolean maxPlayerlife) {
        Map<CardView, Integer> result = new java.util.HashMap<>();
        if (blockers.isEmpty()) {
            return result;
        }
        if (blockers.size() == 1) {
            // no real choice to make — single blocker takes it all
            result.put(blockers.get(0), damage);
            return result;
        }
        List<String> labels = new ArrayList<>();
        for (CardView b : blockers) labels.add(entityLabel(b));
        pendingChoice = PendingChoice.combatDamage(entityLabel(attacker), labels, damage);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> amounts = parseIndices(answer);
        int total = 0;
        for (int a : amounts) total += a;
        if (amounts.size() != blockers.size() || total != damage) {
            // malformed/short answer — fall back to the old deterministic
            // default rather than hand Forge a split that doesn't sum right
            result.put(blockers.get(0), damage);
            return result;
        }
        for (int i = 0; i < blockers.size(); i++) {
            result.put(blockers.get(i), amounts.get(i));
        }
        return result;
    }

    @Override
    public Map<Object, Integer> assignGenericAmount(CardView sa, Map<Object, Integer> targets, int amount, boolean atLeastOne, String amountLabel) {
        Map<Object, Integer> result = new java.util.HashMap<>();
        List<Object> keys = new ArrayList<>(targets.keySet());
        if (keys.isEmpty()) {
            return result;
        }
        if (keys.size() == 1) {
            // no real choice to make — the one target takes it all
            result.put(keys.get(0), amount);
            return result;
        }
        List<String> labels = new ArrayList<>();
        for (Object key : keys) {
            labels.add(key instanceof GameEntityView ? entityLabel((GameEntityView) key) : String.valueOf(key));
        }
        String label = (amountLabel == null || amountLabel.isEmpty()) ? "amount" : amountLabel;
        pendingChoice = PendingChoice.splitAmount("Distribute " + amount + " " + label, labels, amount, atLeastOne);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> amounts = parseIndices(answer);
        int total = 0;
        for (int a : amounts) total += a;
        boolean everyTargetMet = true;
        if (atLeastOne) {
            for (int a : amounts) {
                if (a < 1) { everyTargetMet = false; break; }
            }
        }
        if (amounts.size() != keys.size() || total != amount || !everyTargetMet) {
            // malformed/short answer — fall back to the old deterministic
            // default rather than hand Forge a split that doesn't sum right
            result.put(keys.get(0), amount);
            return result;
        }
        for (int i = 0; i < keys.size(); i++) {
            result.put(keys.get(i), amounts.get(i));
        }
        return result;
    }

    @Override
    public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) {
        if (options == null || options.size() <= 1) {
            return defaultOption;
        }
        pendingChoice = PendingChoice.list(message, new ArrayList<>(options), 1, 1);
        String answer = awaitChoiceAnswer();
        pendingChoice = null;
        List<Integer> indices = parseIndices(answer);
        if (indices.isEmpty()) return defaultOption;
        int idx = indices.get(0);
        return (idx >= 0 && idx < options.size()) ? idx : defaultOption;
    }

    // The real scry/surveil entry point on this build (live-tested: Forge's
    // UI_SELECT_FROM_CARD_DISPLAYS preference defaults true on desktop, and
    // isLibgdxPort() is false here, so PlayerControllerHuman.arrangeForScry
    // takes the arrangeForMove()->manipulateCardList() branch rather than
    // the many()/order() branch order() above handles — confirmed by live
    // testing: the order() fix alone left scry silently sending everything
    // to the bottom, no exception, no prompt, because this method was never
    // being called into by that path). arrangeForMove's own post-processing
    // (decompiled from PlayerControllerHuman.class) reconstructs the
    // (top, bottom) pair by scanning the returned list for a contiguous
    // run of "manipulable" cards at the very front (-> bottom pile, in that
    // order) and another at the very back (-> top pile) — so the contract
    // here is: return `cards` rearranged as [chosen-for-bottom...,
    // untouched-non-manipulable-cards-in-original-order...,
    // chosen-for-top...]. Two sequential PendingChoice prompts (bottom
    // subset+order, then top-remainder order) mirror how Forge's own
    // desktop GUI presents scry/surveil as two steps. NOTE: the exact
    // top-pile sub-ordering direction (which end of topChosen lands as the
    // literal top card after arrangeForMove's reverse + GameAction.scry's
    // second reverse) is reasoned from bytecode, not independently
    // live-verified for 3+ card top piles — flag for a closer look if a
    // Scry/Surveil 3+ ever reorders the kept cards backwards in practice.
    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> all = new ArrayList<>();
        for (CardView c : cards) all.add(c);
        List<CardView> moveable = new ArrayList<>();
        for (CardView c : manipulable) moveable.add(c);
        if (moveable.isEmpty()) {
            return all;
        }

        List<CardView> remaining = new ArrayList<>(moveable);
        List<CardView> bottomChosen = new ArrayList<>();
        if (toBottom && !remaining.isEmpty()) {
            List<String> labels = new ArrayList<>();
            for (CardView c : remaining) labels.add(entityLabel(c));
            pendingChoice = PendingChoice.list(title + " — choose cards for the bottom of your library", labels, 0, remaining.size());
            String answer = awaitChoiceAnswer();
            pendingChoice = null;
            for (int idx : parseIndices(answer)) {
                if (idx >= 0 && idx < remaining.size()) bottomChosen.add(remaining.get(idx));
            }
            remaining.removeAll(bottomChosen);
        }

        List<CardView> topChosen = new ArrayList<>(remaining);
        if (toTop && remaining.size() > 1) {
            List<String> labels = new ArrayList<>();
            for (CardView c : remaining) labels.add(entityLabel(c));
            pendingChoice = PendingChoice.list(title + " — arrange cards for the top of your library", labels, remaining.size(), remaining.size());
            String answer = awaitChoiceAnswer();
            pendingChoice = null;
            List<CardView> ordered = new ArrayList<>();
            for (int idx : parseIndices(answer)) {
                if (idx >= 0 && idx < remaining.size()) ordered.add(remaining.get(idx));
            }
            if (ordered.size() == remaining.size()) {
                topChosen = ordered;
            }
        }

        List<CardView> result = new ArrayList<>();
        result.addAll(bottomChosen);
        for (CardView c : all) {
            if (!moveable.contains(c)) result.add(c);
        }
        result.addAll(topChosen);
        return result;
    }

    @Override
    public void setPlayerAvatar(LobbyPlayer player, IHasIcon icon) {
    }
}
