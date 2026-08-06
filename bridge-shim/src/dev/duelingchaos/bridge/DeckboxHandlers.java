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

    // Curated preset library, tracked in the repo — NOT the ~500-deck
    // res/quest/precons that ships inside vendor/forge (that whole tree is
    // gitignored, a per-machine local install, so anything curated there
    // wouldn't survive a fresh checkout). See src/index.ts's PRESETS_DIR.
    private static File preconDir;
    private static File savedDecksDir;

    public static void register(HttpServer server, File decksDir, File preconsDir) {
        savedDecksDir = decksDir;
        preconDir = preconsDir;
        server.createContext("/cards/search", DeckboxHandlers::handleCardSearch);
        server.createContext("/formats/list", DeckboxHandlers::handleFormatsList);
        server.createContext("/decks/list", DeckboxHandlers::handleDecksList);
        server.createContext("/decks/get", DeckboxHandlers::handleDeckGet);
        server.createContext("/decks/save", DeckboxHandlers::handleDeckSave);
        server.createContext("/decks/delete", DeckboxHandlers::handleDeckDelete);
        server.createContext("/legality/check", DeckboxHandlers::handleLegalityCheck);
        server.createContext("/decks/ai-warnings", DeckboxHandlers::handleDeckAiWarnings);
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
        List<String> presets = listDeckNames(preconDir);
        List<String> saved = listDeckNames(savedDecksDir);
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"presets\":").append(CardDbJson.serializeNameList(presets)).append(',');
        sb.append("\"saved\":").append(CardDbJson.serializeNameList(saved)).append(',');
        sb.append("\"presetFormats\":").append(CardDbJson.serializeStringListMap(computePresetFormats()));
        sb.append('}');
        respond(exchange, 200, sb.toString());
    }

    // Presets carry no format of their own (curated from multiple sources —
    // see src/index.ts's PRESETS_DIR comment), so "what format is this
    // opponent deck legal in" has to be derived the same way the curation
    // pass verified it: run every format's own conformance checker against
    // the deck (same structural+banlist pairing as handleLegalityCheck).
    // Presets are static files for the life of the process, so this is
    // computed once and cached rather than re-checked on every /decks/list.
    private static Map<String, List<String>> presetFormatsCache;

    private static Map<String, List<String>> computePresetFormats() {
        if (presetFormatsCache != null) return presetFormatsCache;
        Map<String, List<String>> result = new HashMap<>();
        File[] files = preconDir.listFiles((d, name) -> name.endsWith(".dck"));
        if (files != null) {
            for (File f : files) {
                String name = f.getName().substring(0, f.getName().length() - 4);
                Deck deck = DeckSerializer.fromFile(f);
                if (deck == null) continue;
                List<String> legalIn = new ArrayList<>();
                for (GameFormat format : FModel.getFormats().getOrderedList()) {
                    DeckFormat structuralFormat = structuralFormatFor(format);
                    deck.setDeckFormat(structuralFormat);
                    if (structuralFormat.getDeckConformanceProblem(deck) != null) continue;
                    if (format.getDeckConformanceProblem(deck) != null) continue;
                    legalIn.add(format.getName());
                }
                result.put(name, legalIn);
            }
        }
        presetFormatsCache = result;
        return result;
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
        File dir = "preset".equals(source) ? preconDir : savedDecksDir;
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
        CardPool mainPool = parseDecklist(stripSectionLines(body, null));
        CardPool commanderPool = parseDecklist(stripSectionLines(body, "CMDR"));
        CardPool sideboardPool = parseDecklist(stripSectionLines(body, "SB"));

        GameFormat format = FModel.getFormats().getFormat(formatName);
        DeckFormat structuralFormat = structuralFormatFor(format);

        Deck deck = new Deck("Legality Check");
        deck.putSection(forge.deck.DeckSection.Main, mainPool);
        if (!commanderPool.isEmpty()) deck.putSection(forge.deck.DeckSection.Commander, commanderPool);
        if (!sideboardPool.isEmpty()) deck.putSection(forge.deck.DeckSection.Sideboard, sideboardPool);
        deck.setDeckFormat(structuralFormat);

        String structuralProblem = structuralFormat.getDeckConformanceProblem(deck);
        String banlistProblem = format == null ? null : format.getDeckConformanceProblem(deck);

        int deckSize = mainPool.countAll() + commanderPool.countAll();
        respond(exchange, 200, CardDbJson.serializeLegality(deckSize, structuralProblem, banlistProblem));
    }

    // Which cards in a preset the AI shouldn't be trusted to pilot — reuses
    // Forge's own CardAiHints.getRemAIDecks() (the "AI:RemoveDeck:All" card-
    // script tag), the same signal Forge's own AI deck generator already
    // uses to refuse including a card in a deck it builds for itself. A
    // human picking this precon as their opponent gets the same warning
    // before committing to a match the AI may pilot badly. Only presets are
    // checked — a saved deck is never AI-piloted.
    private static void handleDeckAiWarnings(HttpExchange exchange) throws IOException {
        Map<String, String> query = parseQuery(exchange.getRequestURI().getRawQuery());
        String name = query.get("name");
        if (name == null || !isSafeName(name)) {
            respond(exchange, 400, "{\"error\":\"missing or invalid name\"}");
            return;
        }
        File deckFile = new File(preconDir, name + ".dck");
        if (!deckFile.isFile()) {
            respond(exchange, 404, "{\"error\":\"deck not found\"}");
            return;
        }
        Deck deck = DeckSerializer.fromFile(deckFile);
        if (deck == null) {
            respond(exchange, 500, "{\"error\":\"failed to parse deck file\"}");
            return;
        }
        List<String> flagged = new ArrayList<>();
        forge.deck.DeckSection[] sections = { forge.deck.DeckSection.Main, forge.deck.DeckSection.Commander };
        for (forge.deck.DeckSection section : sections) {
            if (!deck.has(section)) continue;
            for (Map.Entry<PaperCard, Integer> e : deck.get(section)) {
                PaperCard pc = e.getKey();
                if (pc.getRules().getAiHints().getRemAIDecks() && !flagged.contains(pc.getName())) {
                    flagged.add(pc.getName());
                }
            }
        }
        respond(exchange, 200, CardDbJson.serializeNameList(flagged));
    }

    // toDecklistText (frontend/src/api.ts) tags a card's line with a trailing
    // " {CMDR}"/" {SB}" marker for the commander/side-deck sections; this
    // pulls out just the lines matching the given marker (or, for
    // marker == null, the plain untagged Main-section lines), stripping the
    // marker itself so the result is plain "N Name" text CardPool.fromCardList
    // can parse directly.
    private static String stripSectionLines(String body, String marker) {
        StringBuilder sb = new StringBuilder();
        String suffix = marker == null ? null : " {" + marker + "}";
        for (String rawLine : body.split("\n")) {
            String line = rawLine.trim();
            if (line.isEmpty()) continue;
            boolean isCmdr = line.endsWith(" {CMDR}");
            boolean isSb = line.endsWith(" {SB}");
            if (marker == null) {
                if (isCmdr || isSb) continue;
                sb.append(line).append('\n');
            } else if (suffix != null && line.endsWith(suffix)) {
                sb.append(line, 0, line.length() - suffix.length()).append('\n');
            }
        }
        return sb.toString();
    }

    // The selected format is a GameFormat (banlist/legal-sets — a separate
    // axis from deck *shape*), so it was previously ignored for the
    // structural check entirely, meaning every format got Constructed's
    // 60-card rules — a Commander deck's missing-commander/singleton
    // violations never surfaced. DeckFormat's enum constants share exact
    // names with the formats that need a different shape (verified against
    // the actual res/formats/*.txt files: Commander.txt/Oathbreaker.txt/
    // Brawl.txt/Pauper.txt all use "Name:" matching a DeckFormat constant
    // 1:1), so valueOf-by-name covers those directly. Names that don't
    // match (Standard/Modern/Legacy/Vintage/Pioneer/Extended/Block, or a
    // casual format like PreDH with no DeckFormat entry of its own) fall
    // back to the format's own Commander subtype signal — PreDH.txt
    // declares Subtype:Commander despite not being named "Commander" — and
    // Constructed's ordinary shape otherwise.
    private static DeckFormat structuralFormatFor(GameFormat format) {
        if (format == null) return DeckFormat.Constructed;
        try {
            return DeckFormat.valueOf(format.getName());
        } catch (IllegalArgumentException e) {
            return format.getFormatSubType() == GameFormat.FormatSubType.COMMANDER
                ? DeckFormat.Commander
                : DeckFormat.Constructed;
        }
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
