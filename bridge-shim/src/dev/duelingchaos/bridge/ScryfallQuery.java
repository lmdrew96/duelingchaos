package dev.duelingchaos.bridge;

import forge.card.CardRules;
import forge.card.CardRulesPredicates;
import forge.card.MagicColor;
import forge.util.ComparableOp;
import forge.util.PredicateString.StringOp;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

// Scryfall-style query syntax (t:, c:, o:, mv/cmc, pow/tou/loy, name:, plain
// text, `-` negation) built on Forge's own forge.card.CardRulesPredicates —
// the same predicate primitives Forge's desktop deck editor uses for its
// "Scryfall-like syntax" advanced search (see
// vendor/forge/docs/Advanced-Search.md). That editor's own query grammar
// (forge.itemmanager.AdvancedSearch/AdvancedSearchParser) is Swing-coupled
// and not worth dragging into this headless bridge, so this is a small
// standalone parser over the same building blocks. Scope: implicit AND
// across space-separated terms, `-` prefix negation, and quoted phrases —
// no OR/parentheses grammar, which real deckbuilding queries rarely need.
public final class ScryfallQuery {
    private ScryfallQuery() {}

    private static final String[] KEYWORDS = {
        "type", "t", "color", "c", "oracle", "text", "o",
        "manavalue", "cmc", "mv", "power", "pow", "toughness", "tou",
        "loyalty", "loy", "name",
    };

    public static Predicate<CardRules> parse(String query) {
        List<Predicate<CardRules>> terms = new ArrayList<>();
        for (String token : tokenize(query)) {
            boolean negate = token.length() > 1 && token.charAt(0) == '-';
            String body = negate ? token.substring(1) : token;
            Predicate<CardRules> p = parseTerm(body);
            if (p == null) continue;
            terms.add(negate ? p.negate() : p);
        }
        return card -> {
            for (Predicate<CardRules> p : terms) {
                if (!p.test(card)) return false;
            }
            return true;
        };
    }

    // Splits on unquoted whitespace; a quoted phrase (with its quotes) stays
    // one token so `o:"draw a card"` isn't torn apart on the inner spaces.
    private static List<String> tokenize(String query) {
        List<String> tokens = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < query.length(); i++) {
            char c = query.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
                cur.append(c);
            } else if (Character.isWhitespace(c) && !inQuotes) {
                if (cur.length() > 0) {
                    tokens.add(cur.toString());
                    cur.setLength(0);
                }
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) tokens.add(cur.toString());
        return tokens;
    }

    private static Predicate<CardRules> parseTerm(String token) {
        for (String kw : KEYWORDS) {
            if (token.length() <= kw.length()) continue;
            if (!token.regionMatches(true, 0, kw, 0, kw.length())) continue;
            if (":=!<>".indexOf(token.charAt(kw.length())) < 0) continue;
            return build(kw.toLowerCase(), token.substring(kw.length()));
        }
        String bare = unquote(token);
        if (bare.isEmpty()) return null;
        return CardRulesPredicates.name(StringOp.CONTAINS_IC, bare)
            .or(CardRulesPredicates.joinedType(StringOp.CONTAINS_IC, bare))
            .or(CardRulesPredicates.rules(StringOp.CONTAINS_IC, bare));
    }

    // rest starts at the operator, e.g. ":creature", ">=3", "!gruul".
    private static Predicate<CardRules> build(String kw, String rest) {
        String op = null;
        for (String candidate : new String[] {">=", "<=", "!="}) {
            if (rest.startsWith(candidate)) {
                op = candidate;
                rest = rest.substring(2);
                break;
            }
        }
        if (op == null && !rest.isEmpty() && ":=!<>".indexOf(rest.charAt(0)) >= 0) {
            op = rest.substring(0, 1);
            rest = rest.substring(1);
        }
        if (op == null || rest.isEmpty()) return null;
        String value = unquote(rest);
        if (value.isEmpty()) return null;

        switch (kw) {
            case "t":
            case "type":
                return CardRulesPredicates.joinedType(StringOp.CONTAINS_IC, value);
            case "o":
            case "oracle":
            case "text":
                return CardRulesPredicates.rules(StringOp.CONTAINS_IC, value);
            case "name":
                if (op.equals("!")) return CardRulesPredicates.name(StringOp.EQUALS_IC, value);
                if (op.equals("!=")) return CardRulesPredicates.name(StringOp.CONTAINS_IC, value).negate();
                return CardRulesPredicates.name(StringOp.CONTAINS_IC, value);
            case "c":
            case "color":
                return colorPredicate(op, value);
            case "manavalue":
            case "cmc":
            case "mv":
                return numeric(op, value, CardRulesPredicates::cmc);
            case "pow":
            case "power":
                return numeric(op, value, CardRulesPredicates::power);
            case "tou":
            case "toughness":
                return numeric(op, value, CardRulesPredicates::toughness);
            case "loy":
            case "loyalty":
                return numeric(op, value, CardRulesPredicates::loyalty);
            default:
                return null;
        }
    }

    private interface NumericPredicate {
        Predicate<CardRules> apply(ComparableOp op, int value);
    }

    private static Predicate<CardRules> numeric(String op, String value, NumericPredicate factory) {
        ComparableOp cop = comparableOp(op);
        Integer n = parseInt(value);
        if (cop == null || n == null) return null;
        return factory.apply(cop, n);
    }

    private static ComparableOp comparableOp(String op) {
        switch (op) {
            case ":":
            case "=":
                return ComparableOp.EQUALS;
            case "!=":
                return ComparableOp.NOT_EQUALS;
            case ">":
                return ComparableOp.GREATER_THAN;
            case "<":
                return ComparableOp.LESS_THAN;
            case ">=":
                return ComparableOp.GT_OR_EQUAL;
            case "<=":
                return ComparableOp.LT_OR_EQUAL;
            default:
                return null;
        }
    }

    // hasColor()/isMonoColor() are Forge's HasAllOf ("contains at least
    // these colors") and Equals ("colors are exactly these") predicates —
    // c:rg / c=rg / c!rg in Forge's own Advanced-Search.md examples.
    private static Predicate<CardRules> colorPredicate(String op, String value) {
        String v = value.toLowerCase();
        if (v.equals("c") || v.equals("colorless")) return CardRulesPredicates.IS_COLORLESS;
        if (v.equals("m") || v.equals("multi") || v.equals("multicolor")) return CardRulesPredicates.IS_MULTICOLOR;
        int mask = colorMask(v);
        if (mask < 0) return null;
        boolean exact = op.equals("=") || op.equals("!");
        return exact ? CardRulesPredicates.isMonoColor((byte) mask) : CardRulesPredicates.hasColor((byte) mask);
    }

    private static int colorMask(String v) {
        switch (v) {
            case "white": return MagicColor.WHITE;
            case "blue": return MagicColor.BLUE;
            case "black": return MagicColor.BLACK;
            case "red": return MagicColor.RED;
            case "green": return MagicColor.GREEN;
        }
        int mask = 0;
        for (int i = 0; i < v.length(); i++) {
            int c = letterColor(v.charAt(i));
            if (c == 0) return -1;
            mask |= c;
        }
        return mask == 0 ? -1 : mask;
    }

    private static int letterColor(char c) {
        switch (c) {
            case 'w': return MagicColor.WHITE;
            case 'u': return MagicColor.BLUE;
            case 'b': return MagicColor.BLACK;
            case 'r': return MagicColor.RED;
            case 'g': return MagicColor.GREEN;
            default: return 0;
        }
    }

    private static Integer parseInt(String s) {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String unquote(String s) {
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }
}
