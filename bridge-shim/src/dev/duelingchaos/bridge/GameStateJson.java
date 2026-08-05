package dev.duelingchaos.bridge;

import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;

// Minimal hand-rolled JSON writer: the state shape here is small and fixed,
// so a real JSON library isn't worth the extra dependency yet.
public final class GameStateJson {
    private GameStateJson() {}

    public static String serialize(GameView game, BridgeGuiGame gui) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        field(sb, "turn", game.getTurn()); sb.append(',');
        field(sb, "phase", String.valueOf(game.getPhase())); sb.append(',');
        field(sb, "playerTurn", game.getPlayerTurn() == null ? null : game.getPlayerTurn().getLobbyPlayerName()); sb.append(',');
        field(sb, "gameOver", game.isGameOver()); sb.append(',');
        sb.append("\"pendingPrompt\":"); writePendingPrompt(sb, gui); sb.append(',');
        sb.append("\"pendingChoice\":"); writePendingChoice(sb, gui); sb.append(',');

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
            sb.append('"').append(escape(s.toString())).append('"');
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
        field(sb, "damage", c.damage);
        sb.append('}');
    }

    private static void writePlayer(StringBuilder sb, PlayerView p) {
        sb.append('{');
        field(sb, "name", p.getLobbyPlayerName()); sb.append(',');
        field(sb, "life", p.getLife()); sb.append(',');
        field(sb, "isAI", p.isAI()); sb.append(',');
        sb.append("\"hand\":"); writeCards(sb, p.getHand()); sb.append(',');
        sb.append("\"battlefield\":"); writeCards(sb, p.getBattlefield()); sb.append(',');
        sb.append("\"graveyard\":"); writeCards(sb, p.getGraveyard()); sb.append(',');
        sb.append("\"libraryCount\":").append(p.getZoneSize(ZoneType.Library));
        sb.append('}');
    }

    private static void writeCards(StringBuilder sb, FCollectionView<CardView> cards) {
        sb.append('[');
        boolean first = true;
        for (CardView c : cards) {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            field(sb, "name", c.getCurrentState().getName()); sb.append(',');
            field(sb, "tapped", c.isTapped()); sb.append(',');
            field(sb, "power", c.getCurrentState().getPower()); sb.append(',');
            field(sb, "toughness", c.getCurrentState().getToughness());
            sb.append('}');
        }
        sb.append(']');
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
