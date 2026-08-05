package dev.duelingchaos.bridge;

import forge.card.CardRules;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.game.GameFormat;
import forge.item.PaperCard;

import java.util.List;

// Hand-rolled JSON writer for the deckbuilder endpoints, same rationale as
// GameStateJson: the response shapes here are small and fixed, so a real
// JSON library isn't worth the extra dependency.
public final class CardDbJson {
    private CardDbJson() {}

    public static String serializeCards(List<PaperCard> cards) {
        StringBuilder sb = new StringBuilder();
        sb.append('[');
        boolean first = true;
        for (PaperCard pc : cards) {
            if (!first) sb.append(',');
            first = false;
            writeCard(sb, pc);
        }
        sb.append(']');
        return sb.toString();
    }

    public static String serializeCardSearch(List<PaperCard> cards, boolean truncated) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"cards\":").append(serializeCards(cards)).append(',');
        sb.append("\"truncated\":").append(truncated);
        sb.append('}');
        return sb.toString();
    }

    private static void writeCard(StringBuilder sb, PaperCard pc) {
        CardRules r = pc.getRules();
        sb.append('{');
        field(sb, "name", pc.getName()); sb.append(',');
        field(sb, "manaCost", r.getManaCost() == null ? "" : r.getManaCost().toString()); sb.append(',');
        field(sb, "type", String.valueOf(r.getType())); sb.append(',');
        field(sb, "colors", r.getColor() == null ? "" : r.getColor().toString()); sb.append(',');
        field(sb, "power", r.getPower()); sb.append(',');
        field(sb, "toughness", r.getToughness()); sb.append(',');
        field(sb, "oracleText", r.getOracleText());
        sb.append('}');
    }

    public static String serializeFormatNames(Iterable<GameFormat> formats) {
        StringBuilder sb = new StringBuilder();
        sb.append('[');
        boolean first = true;
        for (GameFormat f : formats) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escape(f.getName())).append('"');
        }
        sb.append(']');
        return sb.toString();
    }

    public static String serializeNameList(List<String> names) {
        StringBuilder sb = new StringBuilder();
        sb.append('[');
        boolean first = true;
        for (String n : names) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escape(n)).append('"');
        }
        sb.append(']');
        return sb.toString();
    }

    public static String serializeDeck(String name, Deck deck) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        field(sb, "name", name); sb.append(',');
        CardPool main = deck.getMain();
        sb.append("\"deckSize\":").append(main.countAll()).append(',');
        sb.append("\"cards\":[");
        boolean first = true;
        for (java.util.Map.Entry<PaperCard, Integer> e : main) {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            field(sb, "name", e.getKey().getName()); sb.append(',');
            sb.append("\"count\":").append(e.getValue());
            sb.append('}');
        }
        sb.append(']');
        sb.append('}');
        return sb.toString();
    }

    public static String serializeLegality(int deckSize, String structuralProblem, String banlistProblem) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"legal\":").append(structuralProblem == null && banlistProblem == null).append(',');
        sb.append("\"deckSize\":").append(deckSize).append(',');
        field(sb, "structuralProblem", structuralProblem); sb.append(',');
        field(sb, "banlistProblem", banlistProblem);
        sb.append('}');
        return sb.toString();
    }

    static void field(StringBuilder sb, String key, String value) {
        sb.append('"').append(key).append("\":");
        if (value == null) sb.append("null");
        else sb.append('"').append(escape(value)).append('"');
    }

    static String escape(String s) {
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
