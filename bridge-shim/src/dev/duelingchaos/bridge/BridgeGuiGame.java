package dev.duelingchaos.bridge;

import forge.LobbyPlayer;
import forge.deck.CardPool;
import forge.game.GameEntityView;
import forge.game.GameState;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.TimeUnit;

// AbstractGuiGame (the same base Forge's own desktop/mobile GUIs extend)
// already implements most of IGuiGame's plumbing — state tracking, zone
// updates, etc. What's left below is the actual "ask a human something"
// surface: dialogs, choices, targeting. Since nothing drives this over HTTP
// yet, every one of these takes the simplest deterministic default (first
// option, minimum required, no-op) rather than blocking forever waiting for
// a UI that doesn't exist. Good enough to prove land/spell/pass-priority;
// anything needing a *real* choice (targeting, modes, X-cost, mana payment
// choices) will surface as a wrong-but-not-hung default during testing —
// each is a candidate for a real HTTP prompt endpoint once we hit it.
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

    public String getPromptMessage() { return promptMessage; }
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
        public final boolean isNumeric;
        public final String initialInput;
        public final String attacker;
        public final int damage;

        private PendingChoice(String kind, String title, List<String> options, int min, int max,
                boolean optional, boolean isNumeric, String initialInput, String attacker, int damage) {
            this.kind = kind;
            this.title = title;
            this.options = options;
            this.min = min;
            this.max = max;
            this.optional = optional;
            this.isNumeric = isNumeric;
            this.initialInput = initialInput;
            this.attacker = attacker;
            this.damage = damage;
        }

        static PendingChoice list(String title, List<String> options, int min, int max) {
            return new PendingChoice("list", title, options, min, max, false, false, null, null, 0);
        }

        static PendingChoice target(String title, List<String> options, boolean optional) {
            return new PendingChoice("target", title, options, optional ? 0 : 1, 1, optional, false, null, null, 0);
        }

        static PendingChoice targets(String title, List<String> options, int min, int max) {
            return new PendingChoice("targets", title, options, min, max, min == 0, false, null, null, 0);
        }

        static PendingChoice number(String title, String initialInput) {
            return new PendingChoice("number", title, null, 0, 0, false, true, initialInput, null, 0);
        }

        static PendingChoice combatDamage(String attacker, List<String> blockerLabels, int damage) {
            return new PendingChoice("combatDamage", "Assign combat damage", blockerLabels, 0, 0, false, false, null, attacker, damage);
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

    @Override
    public <T> IGuiGame.OrderResult<T> order(String title, String top, int min, int max,
            List<T> sourceChoices, List<T> destChoices, CardView referenceCard, boolean sideboardingMode, boolean isFreeform) {
        return new IGuiGame.OrderResult<>(sourceChoices, false);
    }

    @Override
    public void updateButtons(PlayerView owner, String label1, String label2, boolean enable1, boolean enable2, boolean focus1) {
        button1Label = label1;
        button2Label = label2;
        button1Enabled = enable1;
        button2Enabled = enable2;
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
        if (choices.size() <= Math.max(min, 0)) {
            // no real freedom — must take every option to satisfy min
            return new ArrayList<>(choices);
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
        return defaultIsYes;
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
        for (GameEntityView e : optionList) labels.add(entityLabel(e));
        pendingChoice = PendingChoice.target(title, labels, isOptional);
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
        for (GameEntityView e : optionList) labels.add(entityLabel(e));
        pendingChoice = PendingChoice.targets(title, labels, min, max);
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
        return defaultIsYes;
    }

    @Override
    public void showPromptMessage(PlayerView player, String message, CardView referenceCard) {
        System.out.println("[gui prompt] " + player + ": " + message);
        promptMessage = message;
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

    @Override
    public SpellAbilityView getAbilityToPlay(CardView hostCard, List<SpellAbilityView> abilities, ITriggerEvent triggerEvent) {
        if (abilities.isEmpty()) {
            return null;
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
        for (Object key : targets.keySet()) {
            result.put(key, amount);
            break;
        }
        return result;
    }

    @Override
    public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) {
        return defaultOption;
    }

    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> result = new ArrayList<>();
        for (CardView c : cards) {
            result.add(c);
        }
        return result;
    }

    @Override
    public void setPlayerAvatar(LobbyPlayer player, IHasIcon icon) {
    }
}
