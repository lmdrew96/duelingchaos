package dev.duelingchaos.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import forge.GuiDesktop;
import forge.deck.Deck;
import forge.deck.io.DeckSerializer;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.player.PlayerControllerHuman;
import forge.player.LobbyPlayerHuman;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Phase 2 spike: one seat is human-controlled (driven over HTTP), the other
// is AI. Proves a full turn — playing a land, casting a spell, passing
// priority — can be piloted with no UI attached at all.
public class BridgeMain {
    private static volatile Game currentGame;
    private static volatile PlayerControllerHuman humanController;
    private static volatile Player humanPlayer;
    private static volatile BridgeGuiGame gui;

    public static void main(String[] args) throws IOException {
        if (args.length < 2) {
            System.err.println("Usage: BridgeMain <deck1.dck> <deck2.dck> [port] [decksDir]");
            System.exit(1);
        }

        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);

        Deck humanDeck = DeckSerializer.fromFile(new File(args[0]));
        Deck aiDeck = DeckSerializer.fromFile(new File(args[1]));
        if (humanDeck == null || aiDeck == null) {
            System.err.println("Failed to load one or both deck files");
            System.exit(1);
        }

        int port = args.length > 2 ? Integer.parseInt(args[2]) : 8787;
        File decksDir = args.length > 3 ? new File(args[3]) : new File("decks");

        GameRules rules = new GameRules(GameType.Constructed);
        rules.setAppliedVariants(EnumSet.of(GameType.Constructed));

        RegisteredPlayer rpHuman = new RegisteredPlayer(humanDeck);
        rpHuman.setPlayer(new LobbyPlayerHuman("You"));
        RegisteredPlayer rpAi = new RegisteredPlayer(aiDeck);
        rpAi.setPlayer(GamePlayerUtil.createAiPlayer(aiDeck.getName(), 1));

        List<RegisteredPlayer> players = new ArrayList<>();
        players.add(rpHuman);
        players.add(rpAi);

        Match match = new Match(rules, players, "DuelingChaosBridge");
        Game game = match.createGame();
        currentGame = game;

        for (Player p : game.getPlayers()) {
            if (p.getLobbyPlayer() instanceof LobbyPlayerHuman) {
                humanPlayer = p;
                humanController = (PlayerControllerHuman) p.getController();
                break;
            }
        }
        if (humanController == null) {
            System.err.println("Failed to locate the human seat's controller");
            System.exit(1);
        }

        BridgeGuiGame newGui = new BridgeGuiGame();
        newGui.setOriginalGameController(humanPlayer.getView(), humanController);
        newGui.setGameView(game.getView());
        humanController.setGui(newGui);
        newGui.setCurrentPlayer(humanPlayer.getView());
        gui = newGui;

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/state", BridgeMain::handleState);
        server.createContext("/action/pass-priority", BridgeMain::handlePassPriority);
        server.createContext("/action/play-card", BridgeMain::handlePlayCard);
        server.createContext("/action/tap-land", BridgeMain::handleTapLand);
        server.createContext("/action/select-ok", exchange -> handleButton(exchange, true));
        server.createContext("/action/select-cancel", exchange -> handleButton(exchange, false));
        server.createContext("/action/select-choice", BridgeMain::handleSelectChoice);
        server.createContext("/action/select-number", BridgeMain::handleSelectNumber);
        DeckboxHandlers.register(server, decksDir);
        server.setExecutor(null);
        server.start();
        System.out.println("BRIDGE_READY port=" + port);

        Thread gameThread = new Thread(() -> {
            try {
                match.startGame(game);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, "forge-game-thread");
        gameThread.setDaemon(true);
        gameThread.start();
    }

    private static void handleState(HttpExchange exchange) throws IOException {
        Game game = currentGame;
        String json = game == null ? "{}" : GameStateJson.serialize(game.getView(), gui);
        respond(exchange, 200, json);
    }

    private static void handlePassPriority(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        humanController.passPriority();
        respond(exchange, 200, "{\"ok\":true}");
    }

    // Covers non-priority prompts routed through the two generic dialog
    // buttons (e.g. the opening-hand keep/mulligan choice) rather than
    // through passPriority/selectCard.
    private static void handleButton(HttpExchange exchange, boolean ok) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        if (ok) {
            humanController.selectButtonOk();
        } else {
            humanController.selectButtonCancel();
        }
        respond(exchange, 200, "{\"ok\":true}");
    }

    // Playing a land and casting a spell are the same click-a-card-in-hand
    // action from Forge's side (InputProxy figures out what's legal) — one
    // handler covers both of the patch's named actions. Tapping a land for
    // mana is the same "click a card" action too, just aimed at the
    // battlefield instead of the hand — that's what a pending mana-cost
    // prompt (InputPayMana) is waiting on.
    private static final Pattern INDEX_FIELD = Pattern.compile("\"index\"\\s*:\\s*(\\d+)");
    private static final Pattern INDICES_FIELD = Pattern.compile("\"indices\"\\s*:\\s*\\[([^\\]]*)\\]");
    private static final Pattern VALUE_FIELD = Pattern.compile("\"value\"\\s*:\\s*(-?\\d+)");

    // Resolves any pending BridgeGuiGame.PendingChoice of kind "list",
    // "target", or "targets" — all three are answered the same way, by
    // index into the options array the frontend was shown.
    private static void handleSelectChoice(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = INDICES_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"indices\\\": [N, ...]}\"}");
            return;
        }
        String answer = m.group(1).replaceAll("\\s+", "");
        boolean ok = gui != null && gui.resolveChoice(answer);
        respond(exchange, 200, "{\"ok\":" + ok + "}");
    }

    // Resolves a pending BridgeGuiGame.PendingChoice of kind "number" — the
    // X-cost / numeric-input prompt.
    private static void handleSelectNumber(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = VALUE_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"value\\\": N}\"}");
            return;
        }
        boolean ok = gui != null && gui.resolveChoice(m.group(1));
        respond(exchange, 200, "{\"ok\":" + ok + "}");
    }

    private static void handlePlayCard(HttpExchange exchange) throws IOException {
        handleSelectFromZone(exchange, ZoneType.Hand);
    }

    private static void handleTapLand(HttpExchange exchange) throws IOException {
        handleSelectFromZone(exchange, ZoneType.Battlefield);
    }

    private static void handleSelectFromZone(HttpExchange exchange, ZoneType zone) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }

        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = INDEX_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"index\\\": N}\"}");
            return;
        }
        int index = Integer.parseInt(m.group(1));

        Card target = null;
        int i = 0;
        for (Card c : humanPlayer.getCardsIn(zone)) {
            if (i == index) {
                target = c;
                break;
            }
            i++;
        }
        if (target == null) {
            respond(exchange, 400, "{\"error\":\"no card at that index in " + zone + "\"}");
            return;
        }

        boolean selected = humanController.selectCard(CardView.get(target), Collections.emptyList(), null);
        respond(exchange, 200, "{\"ok\":" + selected + "}");
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
