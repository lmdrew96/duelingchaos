package dev.duelingchaos.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import forge.GuiDesktop;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckSection;
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
import java.nio.file.Files;
import java.nio.file.Paths;
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
            System.err.println("Usage: BridgeMain <deck1.dck> <deck2.dck> [port] [decksDir] [preconsDir]");
            System.exit(1);
        }

        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);

        Deck humanDeck = loadDeck(args[0]);
        Deck aiDeck = loadDeck(args[1]);
        if (humanDeck == null || aiDeck == null) {
            System.err.println("Failed to load one or both deck files");
            System.exit(1);
        }

        int port = args.length > 2 ? Integer.parseInt(args[2]) : 8787;
        File decksDir = args.length > 3 ? new File(args[3]) : new File("decks");
        File preconsDir = args.length > 4 ? new File(args[4]) : new File("res/quest/precons");

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
        server.createContext("/action/play-card", BridgeMain::handlePlayCard);
        server.createContext("/action/tap-land", BridgeMain::handleTapLand);
        server.createContext("/action/select-ok", exchange -> handleButton(exchange, true));
        server.createContext("/action/select-cancel", exchange -> handleButton(exchange, false));
        server.createContext("/action/select-choice", BridgeMain::handleSelectChoice);
        server.createContext("/action/select-number", BridgeMain::handleSelectNumber);
        server.createContext("/action/assign-damage", BridgeMain::handleAssignDamage);
        server.createContext("/action/select-entity", BridgeMain::handleSelectEntity);
        server.createContext("/action/concede", BridgeMain::handleConcede);
        server.createContext("/action/undo", BridgeMain::handleUndo);
        server.createContext("/action/cheat", BridgeMain::handleCheat);
        DeckboxHandlers.register(server, decksDir, preconsDir);
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

    // A ".decklist.txt" path is a plain "N Card Name" per line file (the
    // same format the deckbuilder round-trips saved decks through, see
    // DeckboxHandlers.parseDecklist) — the web app writes one of these for
    // a Neon-saved deck instead of a full Forge .dck file, since it has no
    // Forge classes available to serialize one. Anything else is a real
    // .dck path, handled the normal way.
    private static Deck loadDeck(String path) throws IOException {
        if (!path.endsWith(".decklist.txt")) {
            return DeckSerializer.fromFile(new File(path));
        }
        List<String> lines = new ArrayList<>();
        for (String rawLine : Files.readAllLines(Paths.get(path))) {
            String line = rawLine.trim();
            if (!line.isEmpty()) lines.add(line);
        }
        CardPool pool = CardPool.fromCardList(lines);
        if (pool.countAll() == 0) return null;
        Deck deck = new Deck("Saved Deck");
        deck.putSection(DeckSection.Main, pool);
        deck.setDeckFormat(DeckFormat.Constructed);
        return deck;
    }

    private static void handleState(HttpExchange exchange) throws IOException {
        Game game = currentGame;
        boolean canUndo = humanController != null && humanController.canUndoLastAction();
        String json = game == null ? "{}" : GameStateJson.serialize(game.getView(), gui, canUndo);
        respond(exchange, 200, json);
    }

    // concede() ends the game immediately with the human as the loser — no
    // pendingChoice/rendezvous needed, it's a direct one-way action.
    // Confirming with the player is the frontend's job (same pattern as the
    // deckbuilder's delete-deck confirm).
    private static void handleConcede(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        humanController.concede();
        respond(exchange, 200, "{\"ok\":true}");
    }

    // tryUndoLastAction() is the safe variant of undoLastAction() — returns
    // false instead of throwing when there's nothing to undo, so a stale
    // enabled button (a race with the poll tick) fails soft rather than
    // crashing the game thread.
    private static void handleUndo(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        boolean ok = humanController != null && humanController.tryUndoLastAction();
        respond(exchange, 200, "{\"ok\":" + ok + "}");
    }

    private static final Pattern CHEAT_FIELD = Pattern.compile("\"cheat\"\\s*:\\s*\"(\\w+)\"");

    // Dev-only test/demo tooling (hidden behind the frontend's DEV check) —
    // exposes the useful subset of Forge's IDevModeCheats surface
    // (PlayerControllerHuman.cheat()) that BridgeGuiGame's fixed
    // getChoices/getInteger plumbing can now actually drive: setPlayerLife,
    // addCardToHand, addCardToBattlefield, winGame.
    //
    // Each of those methods makes its OWN blocking IGuiGame calls internally
    // (a player picker, then a life value or card name, etc.) — the same
    // blocking rendezvous forge-game-thread already uses for real decisions
    // (see BridgeGuiGame.getChoices/showInputDialog). Running the cheat
    // directly on this HTTP handler thread would deadlock the single
    // threaded server (setExecutor(null)) against itself: the prompt it
    // produces could only ever be answered by another HTTP request, which
    // can't be processed while this thread is stuck waiting on it. A
    // one-shot background thread keeps that blocking off the HTTP thread —
    // the resulting pendingChoice/pendingPrompt just shows up on the next
    // /state poll and resolves through the existing action endpoints exactly
    // like any other in-game decision.
    private static void handleCheat(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        if (humanController == null) {
            respond(exchange, 409, "{\"error\":\"no active game\"}");
            return;
        }
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = CHEAT_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"cheat\\\": \\\"name\\\"}\"}");
            return;
        }
        Runnable action = cheatActionFor(m.group(1));
        if (action == null) {
            respond(exchange, 400, "{\"error\":\"unknown cheat: " + m.group(1) + "\"}");
            return;
        }
        new Thread(() -> {
            try {
                action.run();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, "cheat-thread").start();
        respond(exchange, 200, "{\"ok\":true}");
    }

    private static Runnable cheatActionFor(String name) {
        forge.interfaces.IDevModeCheats cheats = humanController.cheat();
        switch (name) {
            case "setPlayerLife": return cheats::setPlayerLife;
            case "addCardToHand": return cheats::addCardToHand;
            case "addCardToBattlefield": return cheats::addCardToBattlefield;
            case "winGame": return cheats::winGame;
            default: return null;
        }
    }

    // Covers every generic two-button dialog Forge drives through
    // updateButtons/selectButtonOK/selectButtonCancel — the opening-hand
    // keep/mulligan choice, and (verified via bytecode: PlayerControllerHuman
    // .passPriority() and .selectButtonOk() both resolve to the exact same
    // InputProxy.selectButtonOK() call whenever InputPassPriority is the
    // active input) the ordinary OK/End Turn priority-window buttons too —
    // there used to be a separate dedicated /action/pass-priority route for
    // the latter, redundant with this one and removed.

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
    private static final Pattern AMOUNTS_FIELD = Pattern.compile("\"amounts\"\\s*:\\s*\\[([^\\]]*)\\]");
    private static final Pattern REF_FIELD = Pattern.compile("\"ref\"\\s*:\\s*\"(card|player):(\\d+)\"");

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

    // Resolves a pending BridgeGuiGame.PendingChoice of kind "combatDamage"
    // or "splitAmount" — both are "split a total across pendingChoice.options,
    // in order" and resolveChoice() doesn't care which produced the answer.
    private static void handleAssignDamage(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = AMOUNTS_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"amounts\\\": [N, ...]}\"}");
            return;
        }
        String answer = m.group(1).replaceAll("\\s+", "");
        boolean ok = gui != null && gui.resolveChoice(answer);
        respond(exchange, 200, "{\"ok\":" + ok + "}");
    }

    // Spell/ability target declaration during casting doesn't go through
    // BridgeGuiGame.chooseSingleEntityForEffect at all — confirmed live: it
    // routes through the same click-a-card mechanism as play-card/tap-land
    // (Forge's InputSelectTargets accepts a selectCard/selectPlayer call).
    // Those existing endpoints only reach the human player's own zones
    // though, so this one resolves a "card:<id>" / "player:<id>" ref (the
    // same EntityRef scheme game-state JSON already exposes) across BOTH
    // players' battlefields, for targeting an opponent's creature or either
    // player directly.
    //
    // Also the click target for card-list Inputs Forge drives outside
    // IGuiGame entirely (verified via bytecode: PlayerControllerHuman.
    // chooseCardsForEffect/chooseCardsToDiscardFrom build an
    // InputSelectCardsFromList directly and block on a raw card click,
    // never calling into BridgeGuiGame). humanController.selectCard()
    // already forwards to whatever Input is currently active regardless of
    // which endpoint calls it, so reaching Graveyard/Exile here is what's
    // needed to answer those prompts (e.g. Cache Grab's "choose a permanent
    // card milled this way") — no new choice-resolution path required.
    private static final ZoneType[] SELECTABLE_ZONES = { ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile };

    private static void handleSelectEntity(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            respond(exchange, 405, "{\"error\":\"POST only\"}");
            return;
        }
        String body;
        try (InputStream is = exchange.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        Matcher m = REF_FIELD.matcher(body);
        if (!m.find()) {
            respond(exchange, 400, "{\"error\":\"expected JSON body {\\\"ref\\\": \\\"card:<id>\\\" | \\\"player:<id>\\\"}\"}");
            return;
        }
        String kind = m.group(1);
        int id = Integer.parseInt(m.group(2));
        Game game = currentGame;
        if (game == null) {
            respond(exchange, 400, "{\"error\":\"no game in progress\"}");
            return;
        }
        if ("player".equals(kind)) {
            for (Player p : game.getPlayers()) {
                if (p.getView().getId() == id) {
                    humanController.selectPlayer(p.getView(), null);
                    respond(exchange, 200, "{\"ok\":true}");
                    return;
                }
            }
            respond(exchange, 404, "{\"error\":\"no player with that id\"}");
            return;
        }
        for (Player p : game.getPlayers()) {
            for (ZoneType zone : SELECTABLE_ZONES) {
                for (Card c : p.getCardsIn(zone)) {
                    if (c.getId() == id) {
                        boolean ok = humanController.selectCard(CardView.get(c), Collections.emptyList(), null);
                        respond(exchange, 200, "{\"ok\":" + ok + "}");
                        return;
                    }
                }
            }
        }
        respond(exchange, 404, "{\"error\":\"no selectable card with that id\"}");
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
