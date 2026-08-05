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
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;

// Phase 1 spike: proves Forge's internal game state can be read live and
// serialized to JSON. Both seats are AI (see the handoff brief) — driving
// a human seat via IGuiGame/PlayerControllerHuman is phase 2 scope.
public class BridgeMain {
    private static volatile Game currentGame;

    public static void main(String[] args) throws IOException {
        if (args.length < 2) {
            System.err.println("Usage: BridgeMain <deck1.dck> <deck2.dck> [port]");
            System.exit(1);
        }

        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);

        Deck deck1 = DeckSerializer.fromFile(new File(args[0]));
        Deck deck2 = DeckSerializer.fromFile(new File(args[1]));
        if (deck1 == null || deck2 == null) {
            System.err.println("Failed to load one or both deck files");
            System.exit(1);
        }

        int port = args.length > 2 ? Integer.parseInt(args[2]) : 8787;

        GameRules rules = new GameRules(GameType.Constructed);
        rules.setAppliedVariants(EnumSet.of(GameType.Constructed));

        RegisteredPlayer rp1 = new RegisteredPlayer(deck1);
        rp1.setPlayer(GamePlayerUtil.createAiPlayer(deck1.getName(), 0));
        RegisteredPlayer rp2 = new RegisteredPlayer(deck2);
        rp2.setPlayer(GamePlayerUtil.createAiPlayer(deck2.getName(), 1));

        List<RegisteredPlayer> players = new ArrayList<>();
        players.add(rp1);
        players.add(rp2);

        Match match = new Match(rules, players, "DuelingChaosBridge");
        Game game = match.createGame();
        currentGame = game;

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/state", BridgeMain::handleState);
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
        String json = game == null ? "{}" : GameStateJson.serialize(game.getView());
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
