package dev.duelingchaos.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// Puzzle-mode patch: lists Forge's bundled .pzl files (vendor/forge's own
// res/puzzle, not a DuelingChaos-curated directory — see BridgeMain's
// puzzlesDir) for a picker. Actually starting a puzzle happens in
// BridgeMain itself (forge.gamemodes.puzzle.Puzzle needs to be live before
// the HTTP server exists), so this only covers read-only listing — same
// split as DeckboxHandlers vs BridgeMain's deck loading.
public final class PuzzleHandlers {
    private PuzzleHandlers() {}

    public static void register(HttpServer server, File puzzlesDir) {
        server.createContext("/puzzles/list", exchange -> handleList(exchange, puzzlesDir));
    }

    private static void handleList(HttpExchange exchange, File puzzlesDir) throws IOException {
        List<Map<String, String>> puzzles = new ArrayList<>();
        File[] files = puzzlesDir.listFiles((d, name) -> name.endsWith(".pzl"));
        if (files != null) {
            Arrays.sort(files);
            for (File f : files) {
                Map<String, String> meta = parseMetadata(f);
                meta.put("file", f.getName());
                puzzles.add(meta);
            }
        }
        respond(exchange, 200, serializePuzzles(puzzles));
    }

    // [metadata] is plain "Key:Value" lines at the top of each .pzl file —
    // parsed directly here rather than via forge.gamemodes.puzzle.Puzzle
    // (its Name/Goal/Difficulty/Description fields are package-private with
    // no public getters beyond getName()/getGoalDescription()), since this
    // is read-only listing, not game setup.
    private static Map<String, String> parseMetadata(File f) throws IOException {
        Map<String, String> meta = new LinkedHashMap<>();
        for (String rawLine : Files.readAllLines(f.toPath())) {
            String line = rawLine.trim();
            if (line.equals("[state]")) break;
            if (line.isEmpty() || line.startsWith("[")) continue;
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String key = line.substring(0, colon).trim().toLowerCase();
            String value = line.substring(colon + 1).trim().replace("\\n", "\n");
            if (key.equals("name") || key.equals("goal") || key.equals("difficulty") || key.equals("description")) {
                meta.put(key, value);
            }
        }
        return meta;
    }

    private static String serializePuzzles(List<Map<String, String>> puzzles) {
        StringBuilder sb = new StringBuilder();
        sb.append('[');
        boolean first = true;
        for (Map<String, String> meta : puzzles) {
            if (!first) sb.append(',');
            first = false;
            sb.append('{');
            boolean firstField = true;
            for (Map.Entry<String, String> e : meta.entrySet()) {
                if (!firstField) sb.append(',');
                firstField = false;
                CardDbJson.field(sb, e.getKey(), e.getValue());
            }
            sb.append('}');
        }
        sb.append(']');
        return sb.toString();
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
