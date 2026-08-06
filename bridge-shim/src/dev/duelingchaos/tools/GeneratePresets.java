package dev.duelingchaos.tools;

import forge.GuiDesktop;
import forge.card.CardRules;
import forge.card.ColorSet;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckSection;
import forge.deck.io.DeckSerializer;
import forge.game.GameFormat;
import forge.gui.GuiBase;
import forge.item.PaperCard;
import forge.model.FModel;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.stream.Collectors;

// One-off content-generation tool for the "replace preset decks" patch — not
// part of the running bridge, just a throwaway `java -cp ... GeneratePresets
// <outDir>` invocation. Builds simple, small decks straight from each
// format's own GameFormat.getAllCards()/DeckFormat rules so legality is
// correct by construction against *this* Forge build's actual (partly
// fictional/future) card pool, rather than guessed from real-world MTG
// knowledge — verified again afterward via the running bridge's own
// /legality/check.
public final class GeneratePresets {
    private static final Random RNG = new Random(20260805);
    private static final String[] COLORS = { "W", "U", "B", "R", "G" };
    private static final String[] BASIC_LAND = { "Plains", "Island", "Swamp", "Mountain", "Forest" };

    public static void main(String[] args) throws Exception {
        GuiBase.setInterface(new GuiDesktop());
        FModel.initialize(null, null);

        File outDir = new File(args.length > 0 ? args[0] : "curated-out");
        outDir.mkdirs();

        buildConstructed("Standard", outDir, 3);
        buildConstructed("Pauper", outDir, 3);
        buildCommanderShaped("Brawl", DeckFormat.Brawl, "Brawl", outDir, 3, 59);
        // PreDH has no DeckFormat of its own — structurally a Commander deck
        // (see DeckboxHandlers.structuralFormatFor), just drawn from PreDH's
        // own (pre-2011-set-restricted) legal pool.
        buildCommanderShaped("PreDH", DeckFormat.Commander, "PreDH", outDir, 2, 99);
        buildOathbreaker(outDir, 2);

        System.out.println("Done. Wrote decks to " + outDir.getAbsolutePath());
    }

    // GameFormat.getAllCards() came back empty for Pauper/Oathbreaker in this
    // headless run (likely a lazily-built cache that's normally populated by
    // the full desktop UI) — going through the format's own filter predicate
    // against the raw card DB directly sidesteps whatever that cache needs.
    private static List<PaperCard> legalPool(GameFormat format) {
        return forge.StaticData.instance().getCommonCards().getUniqueCards().stream()
                .filter(format.getFilterPrinted())
                .collect(Collectors.toList());
    }

    private static boolean isMonoOrColorless(CardRules r, String color) {
        ColorSet cs = r.getColor();
        if (cs == null || cs.isColorless()) return true;
        return cs.hasNoColorsExcept(ColorSet.fromNames(colorName(color)));
    }

    private static String colorName(String letter) {
        switch (letter) {
            case "W": return "white";
            case "U": return "blue";
            case "B": return "black";
            case "R": return "red";
            case "G": return "green";
            default: throw new IllegalArgumentException(letter);
        }
    }

    private static String basicLandFor(String color) {
        for (int i = 0; i < COLORS.length; i++) {
            if (COLORS[i].equals(color)) return BASIC_LAND[i];
        }
        throw new IllegalArgumentException(color);
    }

    // ---- Standard / Pauper: simple mono-color creature-heavy pile ----
    private static void buildConstructed(String formatName, File outDir, int count) {
        GameFormat format = FModel.getFormats().getFormat(formatName);
        if (format == null) {
            System.out.println("SKIP " + formatName + ": no such format");
            return;
        }
        List<PaperCard> pool = legalPool(format);
        int made = 0;
        for (String color : COLORS) {
            if (made >= count) break;
            List<PaperCard> spells = pool.stream()
                    .filter((pc) -> !pc.getRules().getType().isLand())
                    .filter((pc) -> isMonoOrColorless(pc.getRules(), color))
                    .collect(Collectors.toList());
            if (spells.size() < 18) {
                System.out.println("SKIP " + formatName + " " + color + ": only " + spells.size() + " candidates");
                continue;
            }
            Collections.shuffle(spells, RNG);
            String deckName = formatName + " " + colorName(color).substring(0, 1).toUpperCase()
                    + colorName(color).substring(1) + " Deck";
            Deck deck = fillSimpleDeck(deckName, spells, basicLandFor(color), 60, 4);
            String problem = format.getDeckConformanceProblem(deck);
            if (problem == null) {
                DeckSerializer.writeDeck(deck, new File(outDir, sanitize(deckName) + ".dck"));
                made++;
                System.out.println("OK   " + formatName + " " + deckName);
            } else {
                System.out.println("FAIL " + formatName + " " + color + ": " + problem);
            }
        }
    }

    // Nonland spells first (up to maxCopies each), then basic lands to reach
    // exactly deckSize.
    private static Deck fillSimpleDeck(String name, List<PaperCard> spells, String basicLand, int deckSize, int maxCopies) {
        CardPool main = new CardPool();
        int total = 0;
        for (PaperCard pc : spells) {
            if (total >= deckSize - 16) break; // leave room for ~16 lands
            int copies = Math.min(maxCopies, deckSize - 16 - total);
            if (copies <= 0) break;
            main.add(pc, copies);
            total += copies;
        }
        PaperCard land = uniqueCard(basicLand);
        main.add(land, deckSize - total);
        Deck deck = new Deck(name);
        deck.putSection(DeckSection.Main, main);
        return deck;
    }

    private static PaperCard uniqueCard(String name) {
        return forge.StaticData.instance().getCommonCards().getCard(name);
    }

    // ---- Brawl / PreDH: commander + color-identity-matched pile ----
    private static void buildCommanderShaped(
            String formatName, DeckFormat shape, String outFormatLabel, File outDir, int count, int nonCommanderSize) {
        GameFormat format = FModel.getFormats().getFormat(formatName);
        if (format == null) {
            System.out.println("SKIP " + formatName + ": no such format");
            return;
        }
        List<PaperCard> pool = legalPool(format);
        List<PaperCard> commanders = pool.stream()
                .filter((pc) -> shape.isLegalCommander(pc.getRules()))
                .collect(Collectors.toList());
        Collections.shuffle(commanders, RNG);

        int made = 0;
        for (PaperCard commander : commanders) {
            if (made >= count) break;
            ColorSet identity = commander.getRules().getColorIdentity();
            List<PaperCard> spells = pool.stream()
                    .filter((pc) -> !pc.getRules().getType().isLand())
                    .filter((pc) -> !pc.getName().equals(commander.getName()))
                    .filter((pc) -> pc.getRules().getColorIdentity().hasNoColorsExcept(identity))
                    .collect(Collectors.toList());
            if (spells.size() < nonCommanderSize - 20) continue;
            Collections.shuffle(spells, RNG);

            CardPool main = new CardPool();
            int total = 0;
            for (PaperCard pc : spells) {
                if (total >= nonCommanderSize - 16) break;
                main.add(pc, 1); // singleton
                total++;
            }
            String landName = identity.isColorless() ? "Wastes" : basicLandFor(firstColorLetter(identity));
            main.add(uniqueCard(landName), nonCommanderSize - total);

            String deckName = outFormatLabel + " — " + commander.getName();
            Deck deck = new Deck(deckName);
            deck.putSection(DeckSection.Main, main);
            CardPool cmdrPool = new CardPool();
            cmdrPool.add(commander, 1);
            deck.putSection(DeckSection.Commander, cmdrPool);

            String problem = format.getDeckConformanceProblem(deck);
            if (problem == null) {
                DeckSerializer.writeDeck(deck, new File(outDir, sanitize(deckName) + ".dck"));
                made++;
                System.out.println("OK   " + formatName + " " + deckName);
            } else {
                System.out.println("FAIL " + formatName + " " + commander.getName() + ": " + problem);
            }
        }
    }

    private static String firstColorLetter(ColorSet cs) {
        for (String c : COLORS) {
            if (cs.hasAnyColor(ColorSet.fromNames(colorName(c)).getColor())) return c;
        }
        return "W";
    }

    // ---- Oathbreaker: planeswalker "oathbreaker" + instant/sorcery "signature spell" ----
    private static void buildOathbreaker(File outDir, int count) {
        GameFormat format = FModel.getFormats().getFormat("Oathbreaker");
        if (format == null) {
            System.out.println("SKIP Oathbreaker: no such format");
            return;
        }
        List<PaperCard> pool = legalPool(format);
        List<PaperCard> walkers = pool.stream()
                .filter((pc) -> pc.getRules().getType().isPlaneswalker())
                .collect(Collectors.toList());
        Collections.shuffle(walkers, RNG);

        int made = 0;
        for (PaperCard oathbreaker : walkers) {
            if (made >= count) break;
            ColorSet identity = oathbreaker.getRules().getColorIdentity();
            List<PaperCard> spells = pool.stream()
                    .filter((pc) -> pc.getRules().getType().isInstant() || pc.getRules().getType().isSorcery())
                    .filter((pc) -> pc.getRules().getColorIdentity().hasNoColorsExcept(identity))
                    .collect(Collectors.toList());
            if (spells.isEmpty()) continue;
            PaperCard signatureSpell = spells.get(RNG.nextInt(spells.size()));

            List<PaperCard> fillers = pool.stream()
                    .filter((pc) -> !pc.getRules().getType().isLand())
                    .filter((pc) -> !pc.getName().equals(oathbreaker.getName()))
                    .filter((pc) -> !pc.getName().equals(signatureSpell.getName()))
                    .filter((pc) -> pc.getRules().getColorIdentity().hasNoColorsExcept(identity))
                    .collect(Collectors.toList());
            if (fillers.size() < 30) continue;
            Collections.shuffle(fillers, RNG);

            CardPool main = new CardPool();
            int total = 0;
            for (PaperCard pc : fillers) {
                if (total >= 58 - 16) break;
                main.add(pc, 1);
                total++;
            }
            String landName = identity.isColorless() ? "Wastes" : basicLandFor(firstColorLetter(identity));
            main.add(uniqueCard(landName), 58 - total);

            String deckName = "Oathbreaker — " + oathbreaker.getName();
            Deck deck = new Deck(deckName);
            deck.putSection(DeckSection.Main, main);
            CardPool cmdrPool = new CardPool();
            cmdrPool.add(oathbreaker, 1);
            cmdrPool.add(signatureSpell, 1);
            deck.putSection(DeckSection.Commander, cmdrPool);

            String problem = format.getDeckConformanceProblem(deck);
            if (problem == null) {
                DeckSerializer.writeDeck(deck, new File(outDir, sanitize(deckName) + ".dck"));
                made++;
                System.out.println("OK   Oathbreaker " + deckName);
            } else {
                System.out.println("FAIL Oathbreaker " + oathbreaker.getName() + ": " + problem);
            }
        }
    }

    private static String sanitize(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
