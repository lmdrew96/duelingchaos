package dev.duelingchaos.bridge;

import forge.card.CardTypeView;
import forge.card.MagicColor;
import forge.card.mana.ManaCost;
import forge.game.GameEntityView;
import forge.game.GameOutcome;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CounterEnumType;
import forge.game.combat.CombatView;
import forge.game.phase.PhaseType;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;

import java.util.ArrayList;
import java.util.List;

// Minimal hand-rolled JSON writer: the state shape here is small and fixed,
// so a real JSON library isn't worth the extra dependency yet.
public final class GameStateJson {
    private GameStateJson() {}

    public static String serialize(GameView game, BridgeGuiGame gui) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        field(sb, "turn", game.getTurn()); sb.append(',');
        field(sb, "stormCount", game.getStormCount()); sb.append(',');
        field(sb, "phase", String.valueOf(game.getPhase())); sb.append(',');
        field(sb, "playerTurn", game.getPlayerTurn() == null ? null : game.getPlayerTurn().getLobbyPlayerName()); sb.append(',');
        boolean gameOver = game.isGameOver();
        field(sb, "gameOver", gameOver); sb.append(',');
        GameOutcome outcome = gameOver ? game.getOutcome() : null;
        boolean isDraw = outcome != null && outcome.isDraw();
        field(sb, "isDraw", isDraw); sb.append(',');
        field(sb, "winnerName", (outcome == null || isDraw || outcome.getWinningLobbyPlayer() == null)
            ? null : outcome.getWinningLobbyPlayer().getName()); sb.append(',');
        sb.append("\"pendingPrompt\":"); writePendingPrompt(sb, gui); sb.append(',');
        sb.append("\"pendingChoice\":"); writePendingChoice(sb, gui); sb.append(',');
        sb.append("\"pointers\":"); writePointers(sb, game); sb.append(',');
        sb.append("\"combat\":"); writeCombat(sb, game); sb.append(',');

        sb.append("\"players\":[");
        boolean first = true;
        for (PlayerView p : game.getPlayers()) {
            if (!first) sb.append(',');
            first = false;
            writePlayer(sb, p);
        }
        sb.append("],");

        sb.append("\"stack\":[");
        first = true;
        for (StackItemView s : game.getStack()) {
            if (!first) sb.append(',');
            first = false;
            writeStackItem(sb, s);
        }
        sb.append(']');

        sb.append('}');
        return sb.toString();
    }

    private static void writePendingPrompt(StringBuilder sb, BridgeGuiGame gui) {
        sb.append('{');
        field(sb, "message", gui == null ? null : gui.getPromptMessage()); sb.append(',');
        field(sb, "button1", gui == null ? null : gui.getButton1Label()); sb.append(',');
        field(sb, "button2", gui == null ? null : gui.getButton2Label()); sb.append(',');
        field(sb, "button1Enabled", gui != null && gui.isButton1Enabled()); sb.append(',');
        field(sb, "button2Enabled", gui != null && gui.isButton2Enabled());
        sb.append('}');
    }

    private static void writePendingChoice(StringBuilder sb, BridgeGuiGame gui) {
        BridgeGuiGame.PendingChoice c = gui == null ? null : gui.getPendingChoice();
        if (c == null) {
            sb.append("null");
            return;
        }
        sb.append('{');
        field(sb, "kind", c.kind); sb.append(',');
        field(sb, "title", c.title); sb.append(',');
        sb.append("\"options\":");
        if (c.options == null) {
            sb.append("null");
        } else {
            sb.append('[');
            boolean first = true;
            for (String opt : c.options) {
                if (!first) sb.append(',');
                first = false;
                sb.append('"').append(escape(opt)).append('"');
            }
            sb.append(']');
        }
        sb.append(',');
        field(sb, "min", c.min); sb.append(',');
        field(sb, "max", c.max); sb.append(',');
        field(sb, "optional", c.optional); sb.append(',');
        field(sb, "isNumeric", c.isNumeric); sb.append(',');
        field(sb, "initialInput", c.initialInput); sb.append(',');
        field(sb, "attacker", c.attacker); sb.append(',');
        field(sb, "amount", c.amount); sb.append(',');
        sb.append("\"refs\":");
        if (c.refs == null) {
            sb.append("null");
        } else {
            sb.append('[');
            boolean first = true;
            for (String ref : c.refs) {
                if (!first) sb.append(',');
                first = false;
                if (ref == null) sb.append("null");
                else sb.append('"').append(escape(ref)).append('"');
            }
            sb.append(']');
        }
        sb.append(',');
        field(sb, "sourceRef", c.sourceRef);
        sb.append('}');
    }

    // Dismissible, non-blocking reminders for legal-but-easy-to-forget
    // options — NOT rule-violation warnings (Forge already enforces those
    // itself; the frontend just gets a rejected action if it tries
    // something illegal). Scoped to the two cheapest conditions to detect
    // from data Forge already tracks per player: an unplayed land drop, and
    // an instant sitting unused in hand while the human holds priority
    // during the opponent's turn (the moment most likely to be forgotten,
    // since nothing else is prompting for input then).
    private static void writePointers(StringBuilder sb, GameView game) {
        PlayerView human = null;
        for (PlayerView p : game.getPlayers()) {
            if (!p.isAI()) { human = p; break; }
        }

        List<String[]> pointers = new ArrayList<>();
        if (human != null) {
            boolean isHumanTurn = game.getPlayerTurn() != null && game.getPlayerTurn().getId() == human.getId();
            PhaseType phase = game.getPhase();
            boolean hasLandInHand = false;
            boolean hasInstantInHand = false;
            for (CardView c : human.getHand()) {
                CardTypeView t = c.getCurrentState().getType();
                if (t == null) continue;
                if (t.isLand()) hasLandInHand = true;
                if (t.isInstant()) hasInstantInHand = true;
            }
            boolean canPlayLand = human.hasUnlimitedLandPlay() || human.getNumLandThisTurn() < human.getMaxLandPlay();

            if (isHumanTurn && phase != null && phase.isMain() && human.getHasPriority() && canPlayLand && hasLandInHand) {
                pointers.add(new String[] { "land-drop", "You haven't played a land this turn." });
            }
            if (!isHumanTurn && human.getHasPriority() && hasInstantInHand) {
                pointers.add(new String[] { "instant-available", "You have priority and an instant in hand." });
            }
        }

        sb.append('[');
        boolean first = true;
        for (String[] p : pointers) {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            field(sb, "id", p[0]); sb.append(',');
            field(sb, "message", p[1]);
            sb.append('}');
        }
        sb.append(']');
    }

    // CombatView is the same trackable, thread-safe snapshot layer as every
    // other *View class here — unlike CombatUtil.canAttack/canBlock (which
    // take live Card/Game objects and would race the forge-game-thread if
    // called from this HTTP-served serialize path), this only ever reads
    // already-declared attackers/blockers. No precomputed "legal to attack/
    // block" set: same as spell-cast targeting elsewhere in this file, the
    // frontend offers the click and Forge silently no-ops an illegal one.
    private static void writeCombat(StringBuilder sb, GameView game) {
        CombatView combat = game.getCombat();
        if (combat == null) {
            sb.append("null");
            return;
        }
        sb.append('{');
        sb.append("\"attackers\":[");
        boolean first = true;
        for (CardView attacker : combat.getAttackers()) {
            if (!first) sb.append(',');
            first = false;
            GameEntityView defender = combat.getDefender(attacker);
            sb.append('{');
            field(sb, "attackerRef", "card:" + attacker.getId()); sb.append(',');
            field(sb, "defenderRef", defender == null ? null : entityRef(defender));
            sb.append('}');
        }
        sb.append("],");
        sb.append("\"blocks\":[");
        first = true;
        for (CardView attacker : combat.getAttackers()) {
            for (CardView blocker : combat.getBlockers(attacker)) {
                if (!first) sb.append(',');
                first = false;
                sb.append('{');
                field(sb, "blockerRef", "card:" + blocker.getId()); sb.append(',');
                field(sb, "attackerRef", "card:" + attacker.getId());
                sb.append('}');
            }
        }
        sb.append(']');
        sb.append('}');
    }

    private static String entityRef(GameEntityView e) {
        if (e instanceof CardView) return "card:" + e.getId();
        if (e instanceof PlayerView) return "player:" + e.getId();
        return null;
    }

    // Each item carries a source (the spell/ability asking) and its already-
    // declared targets, straight from Forge's own StackItemView — real data,
    // not a frontend guess, so targeting arrows for resolving spells are
    // exact. First item from the iterator is treated as top-of-stack (the
    // next thing to resolve).
    private static void writeStackItem(StringBuilder sb, StackItemView s) {
        sb.append('{');
        field(sb, "id", s.getId()); sb.append(',');
        CardView src = s.getSourceCard();
        field(sb, "sourceRef", src == null ? null : "card:" + src.getId()); sb.append(',');
        field(sb, "sourceName", src == null ? null : src.getCurrentState().getName()); sb.append(',');
        field(sb, "text", s.toString()); sb.append(',');
        sb.append("\"targetRefs\":[");
        boolean first = true;
        for (CardView t : s.getTargetCards()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append("card:").append(t.getId()).append('"');
        }
        for (PlayerView t : s.getTargetPlayers()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append("player:").append(t.getId()).append('"');
        }
        sb.append(']');
        sb.append('}');
    }

    private static void writePlayer(StringBuilder sb, PlayerView p) {
        sb.append('{');
        field(sb, "id", p.getId()); sb.append(',');
        field(sb, "name", p.getLobbyPlayerName()); sb.append(',');
        field(sb, "life", p.getLife()); sb.append(',');
        field(sb, "isAI", p.isAI()); sb.append(',');
        field(sb, "poison", p.getCounters(CounterEnumType.POISON)); sb.append(',');
        field(sb, "energy", p.getCounters(CounterEnumType.ENERGY)); sb.append(',');
        field(sb, "experience", p.getCounters(CounterEnumType.EXPERIENCE)); sb.append(',');
        field(sb, "manaPool", manaPoolCost(p)); sb.append(',');
        sb.append("\"hand\":"); writeCards(sb, p.getHand()); sb.append(',');
        sb.append("\"battlefield\":"); writeCards(sb, p.getBattlefield()); sb.append(',');
        sb.append("\"graveyard\":"); writeCards(sb, p.getGraveyard()); sb.append(',');
        sb.append("\"libraryCount\":").append(p.getZoneSize(ZoneType.Library));
        sb.append('}');
    }

    // Rendered as a plain {W}{U}... mana-cost string rather than a
    // structured {color,amount} list so the frontend can reuse its existing
    // ManaPips cost-string renderer as-is for the floating pool too.
    private static String manaPoolCost(PlayerView p) {
        StringBuilder mana = new StringBuilder();
        for (byte color : MagicColor.WUBRGC) {
            int amount = p.getMana(color);
            String code = MagicColor.toShortString(color);
            for (int i = 0; i < amount; i++) {
                mana.append('{').append(code).append('}');
            }
        }
        return mana.toString();
    }

    private static void writeCards(StringBuilder sb, FCollectionView<CardView> cards) {
        sb.append('[');
        boolean first = true;
        for (CardView c : cards) {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            field(sb, "id", c.getId()); sb.append(',');
            field(sb, "name", c.getCurrentState().getName()); sb.append(',');
            field(sb, "tapped", c.isTapped()); sb.append(',');
            field(sb, "power", c.getCurrentState().getPower()); sb.append(',');
            field(sb, "toughness", c.getCurrentState().getToughness()); sb.append(',');
            ManaCost manaCost = c.getCurrentState().getManaCost();
            field(sb, "manaCost", manaCost == null ? "" : manaCost.toString()); sb.append(',');
            field(sb, "typeCategory", typeCategory(c.getCurrentState().getType()));
            sb.append('}');
        }
        sb.append(']');
    }

    // Board grouping only needs one bucket per permanent, not a full type
    // line — Forge's CardTypeView already exposes exact boolean predicates
    // (isCreature/isLand/etc), so there's no need to parse a type-line
    // string client-side the way oracle-text-only tools have to. Creature
    // is checked before Artifact/Enchantment/Land so a multi-type permanent
    // (e.g. an artifact creature, or the rare land creature) groups with
    // its creature-specific mechanics (summoning sickness, combat) rather
    // than its other type.
    private static String typeCategory(CardTypeView t) {
        if (t == null) return "Other";
        if (t.isCreature()) return "Creature";
        if (t.isPlaneswalker()) return "Planeswalker";
        if (t.isBattle()) return "Battle";
        if (t.isLand()) return "Land";
        if (t.isArtifact()) return "Artifact";
        if (t.isEnchantment()) return "Enchantment";
        return "Other";
    }

    private static void field(StringBuilder sb, String key, String value) {
        sb.append('"').append(key).append("\":");
        if (value == null) sb.append("null");
        else sb.append('"').append(escape(value)).append('"');
    }

    private static void field(StringBuilder sb, String key, int value) {
        sb.append('"').append(key).append("\":").append(value);
    }

    private static void field(StringBuilder sb, String key, boolean value) {
        sb.append('"').append(key).append("\":").append(value);
    }

    private static String escape(String s) {
        StringBuilder out = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.toString();
    }
}
