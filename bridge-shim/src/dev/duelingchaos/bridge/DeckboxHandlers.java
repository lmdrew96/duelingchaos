package dev.duelingchaos.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import forge.StaticData;
import forge.card.CardDb;
import forge.card.CardRules;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.io.DeckSerializer;
import forge.game.GameFormat;
import forge.item.PaperCard;
import forge.model.FModel;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

// Deckbuilder patch: card search, format/legality lookups, and deck
// save/load, all backed directly by Forge's own card and format databases
// (StaticData/FModel) rather than a hand-rolled card db. None of this
// touches the live game (currentGame/humanController in BridgeMain) — it's
// pure lookups, so it works whether or not a match is in progress.
public final class DeckboxHandlers {
    private DeckboxHandlers() {}

    private static final File PRECON_DIR = new File("res/quest/precons");
    private static File savedDecksDir;

    public static void register(HttpServer server, File decksDir) {
        savedDecksDir = decksDir;
        server.createContext("/cards/search", DeckboxHandlers::handleCardSearch);
        server.createContext("/formats/list", DeckboxHandlers::handleFormatsList);
        server.createContext("/decks/list", DeckboxHandlers::handleDecksList);
        server.createContext("/decks/get", DeckboxHandlers::handleDeckGet);
        server.createContext("/decks/save", DeckboxHandlers::handleDeckSave);
        server.createContext("/decks/delete", DeckboxHandlers::handleDeckDelete);
        server.createContext("/legality/check", DeckboxHandlers::handleLegalityCheck);
    }

    private static void handleCardSearch(HttpExchange exchange) throws IOException {
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String q = query.getOrDefault("q", "");
        int limit = parseIntOr(query.get("limit"), 300);
        if (limit > 500) limit = 500;

        Predicate<CardRules> predicate = ScryfallQuery.parse(q);
        CardDb db = StaticData.instance().getCommonCards();
        // Collect one past the limit so we can report whether the match set
        // was actually truncated, without a separate full-scan count pass.
        List<PaperCard> results = new ArrayList<>();
        boolean truncated = false;
        for (PaperCard pc : db.getUniqueCards()) {
            if (predicate.test(pc.getRules())) {
                if (results.size() >= limit) {
                    truncated = true;
                    break;
                }
                results.add(pc);
            }
        }
        respond(exchange, 200, CardDbJson.serializeCardSearch(results, truncated));
    }

    private static void handleFormatsList(HttpExchange exchange) throws IOException {
        GameFormat.Collection formats = FModel.getFormats();
        respond(exchange, 200, CardDbJson.serializeFormatNames(formats.getOrderedList()));
    }

    private static void handleDecksList(HttpExchange exchange) throws IOException {
        List<String> presets = listDeckNames(PRECON_DIR);
        List<String> saved = listDeckNames(savedDecksDir);
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"presets\":").append(CardDbJson.serializeNameList(presets)).append(',');
        sb.append("\"saved\":").append(CardDbJson.serializeNameList(saved));
        sb.append('}');
        respond(exchange, 200, sb.toString());
    }

    private static List<String> listDeckNames(File dir) {
        List<String> names = new ArrayList<>();
        File[] files = dir.listFiles((d, name) -> name.endsWith(".dck"));
        if (files == null) return names;
        Arrays.sort(files);
        for (File f : files) {
            String name = f.getName();
            names.add(name.substring(0, name.length() - 4));
        }
        return names;
    }

    private static void handleDeckGet(HttpExchange exchange) throws IOException {
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String source = query.getOrDefault("source", "saved");
        String name = query.get("name");
        if (name == null || !isSafeName(name)) {
            respond(exchange, 400, "{\"error\":\"missing or invalid name\"}");
            return;
        }
        File dir = "preset".equals(source) ? PRECON_DIR : savedDecksDir;
        File deckFile = new File(dir, name + ".dck");
        if (!deckFile.isFile()) {
            respond(exchange, 404, "{\"error\":\"deck not found\"}");
            return;
        }
        Deck deck = DeckSerializer.fromFile(deckFile);
        if (deck == null) {
            respond(exchange, 500, "{\"error\":\"failed to parse deck file\"}");
            return;
        }
        respond(exchange, 200, CardDbJson.serializeDeck(name, deck));
    }

    // Request body is a plain-text decklist, one card per line ("N Card
    // Name") — Forge's own CardPool.fromCardList parses this directly, so
    // there's no need for a JSON body parser here.
    private static void handleDeckSave(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String name = query.get("name");
        if (name == null || !isSafeName(name)) {
            respond(exchange, 400, "{\"error\":\"missing or invalid name\"}");
            return;
        }

        String body = readBody(exchange);
        CardPool pool = parseDecklist(body);
        if (pool.countAll() == 0) {
            respond(exchange, 400, "{\"error\":\"empty or unparseable decklist\"}");
            return;
        }

        Deck deck = new Deck(name);
        deck.putSection(forge.deck.DeckSection.Main, pool);
        deck.setDeckFormat(DeckFormat.Constructed);

        if (!savedDecksDir.isDirectory() && !savedDecksDir.mkdirs()) {
            respond(exchange, 500, "{\"error\":\"failed to create decks directory\"}");
            return;
        }
        DeckSerializer.writeDeck(deck, new File(savedDecksDir, name + ".dck"));
        respond(exchange, 200, CardDbJson.serializeDeck(name, deck));
    }

    private static void handleDeckDelete(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String name = query.get("name");
        if (name == null || !isSafeName(name)) {
            respond(exchange, 400, "{\"error\":\"missing or invalid name\"}");
            return;
        }
        File deckFile = new File(savedDecksDir, name + ".dck");
        boolean deleted = deckFile.isFile() && deckFile.delete();
        respond(exchange, 200, "{\"deleted\":" + deleted + "}");
    }

    private static void handleLegalityCheck(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String formatName = query.getOrDefault("format", "Standard");

        String body = readBody(exchange);
        CardPool pool = parseDecklist(body);

        Deck deck = new Deck("Legality Check");
        deck.putSection(forge.deck.DeckSection.Main, pool);
        deck.setDeckFormat(DeckFormat.Constructed);

        String structuralProblem = DeckFormat.Constructed.getDeckConformanceProblem(deck);

        GameFormat format = FModel.getFormats().getFormat(formatName);
        String banlistProblem = format == null ? null : format.getDeckConformanceProblem(deck);

        respond(exchange, 200, CardDbJson.serializeLegality(pool.countAll(), structuralProblem, banlistProblem));
    }

    @SuppressWarnings("unchecked")
    private static CardPool parseDecklist(String body) {
        List<String> lines = new ArrayList<>();
        for (String line : body.split("\n")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) lines.add(trimmed);
        }
        return CardPool.fromCardList(lines);
    }

    // Deck names become filenames on disk — reject anything that could
    // escape the decks directory.
    private static boolean isSafeName(String name) {
        if (name.isEmpty() || name.length() > 100) return false;
        return !name.contains("/") && !name.contains("\\") && !name.contains("..");
    }

    private static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> result = new HashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) return result;
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            String key = URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8);
            String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            result.put(key, value);
        }
        return result;
    }

    private static int parseIntOr(String s, int fallback) {
        if (s == null) return fallback;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
