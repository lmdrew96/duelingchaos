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

    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices, List<T> selected, FSerializableFunction<T, String> display) {
        int count = Math.max(min, 0);
        return new ArrayList<>(choices.subList(0, Math.min(count, choices.size())));
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
        return optionList.get(0);
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList, int min, int max, DelayedReveal delayedReveal) {
        int count = Math.max(min, 0);
        List<GameEntityView> result = new ArrayList<>();
        for (int i = 0; i < count && i < optionList.size(); i++) {
            result.add(optionList.get(i));
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
        return initialInput;
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
        if (!blockers.isEmpty()) {
            result.put(blockers.get(0), damage);
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
