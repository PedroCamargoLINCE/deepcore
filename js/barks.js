/* DEEPCORE — barks.js (v1.1, SPEC2 §A)
   DC.Barks: FOREMAN GRIT on the rig intercom. Gravel-voiced, chain-smoking,
   Company-hating deep-mining lifer. DOM-free; deterministic via run.rng only.
   API (matches engine.js wiring):
     tick(run)               ambient watcher, called after every Sim.tick
     fire(run, trigger, ctx) discrete trigger; sets run.foreman
     epitaph(run)            gameover lines (cause-aware)
     toast(run)              victory screen line
     core(run, kind, i)      M-CORELORE: the second voice. `kind` is one of
                             'intrusion' | 'gate' | 'reveal' | 'mantle' —
                             these ids are the shared hook other dispatches
                             fire (M-WONDERS' Bell rings 'intrusion' early;
                             M-EVENTS' dead-foreman logs corroborate it).
                             Sets run.foreman with voice:'core' and schedules
                             GRIT's paired deflection.
     pause(run, kind)        M-GRITPLUS: a bark fired while the sim is frozen
                             ('smokeBreak' | 'breakOver'), pre-typed
   run.foreman = { text, t0, until } — t0/until in run.totalT ticks.
   Each line used at most once per run (pool exhausted -> reuse allowed).
   Global cooldown ~6s except priority triggers, which always cut in. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;
  const HZ = D.TICK_HZ;
  const COOLDOWN = 6 * HZ;
  const PRIORITY = { death: 1, victory: 1, breachReady: 1, collapse: 1 };

  // ---------------- line pools (≤70 chars each) ----------------
  const POOLS = {
    runStart: [
      "Another rig, another hole. Try not to marry this one, kid.",
      "Shift starts now. Company says dig. Gravity agrees. Get to it.",
      "Fresh dirt, fresh debts. Feed the drill and nobody gets buried.",
      "Smell that? Topsoil and bad decisions. Welcome back, kid.",
      "Clock's punched. The planet won't hollow itself out. Sadly.",
    ],
    stratumArrive: [
      "New floor, same hole. Watch your footing and your paycheck.",
      "We're down. Everything here wants a bite of the rig. Standard.",
      "Scanner's mapping. I'd say explore, but it's rock and regret.",
      "Fresh stratum. Untouched. Let's fix that with heavy machinery.",
      "Deeper already. My ears popped. My knees filed a complaint.",
    ],
    firstBelt: [
      "First belt down. Rollers and dreams, kid. Mostly rollers.",
      "A belt! Automation! Like the Company pays us to be lazy.",
      "One belt laid. A thousand to go. My back hurts just watching.",
      "There she rolls. Cheaper than an intern and complains less.",
    ],
    firstExtractor: [
      "Extractor's biting. Listen to her chew. That's money noise.",
      "First extractor down. She bites, the rock gives. Match made in hell.",
      "That's it, kid — point the teeth at the shiny stuff.",
      "Extractor set. Now the rock works for US. Feels good, don't it?",
    ],
    firstSmelter: [
      "Smelter's lit. Ore goes in, plates come out, nobody asks how.",
      "First smelter. Warm your hands, lose your eyebrows. It's a spa.",
      "Furnace up. Feed it coal or it sulks like management.",
      "Smelter online. Finally, some honest pollution.",
    ],
    firstAssembler: [
      "Assembler up. Gears feed the drill. Circle of life, kid.",
      "First assembler. Fiddly little thing. Treat her nice, kid.",
      "Assembler humming. Plates becoming purpose. Beautiful noise.",
      "Assembler's in. Now we build excuses to dig deeper. Good ones.",
    ],
    firstGear: [
      "First gear cooking. The drill eats those like I eat regret.",
      "Gear in production! The rig just licked her lips. Figuratively.",
      "There's gear one, kid. A few hundred more and we're famous.",
      "A gear is born. Somewhere an accountant sheds one oily tear.",
    ],
    quake: [
      "That was the planet clearing its throat. Keep working.",
      "Quake! If it rattled loose, it wasn't bolted right. Company spec.",
      "Whole stratum's shrugging. Rude. We barely started digging.",
      "Tremor. Count your machines and your fillings, kid.",
      "Earth moved. And not in the fun way.",
    ],
    bigQuake: [
      "BIG one! Hull took it on the chin. Spit the tooth out, drill on.",
      "Damn! That quake had our name on it. Misspelled, but still.",
      "That one rearranged my organs. Check the rig, kid. Then me.",
      "Hell of a hit! The planet's done flirting. It wants us OUT.",
    ],
    collapse: [
      "COLLAPSE! The stratum's done hosting us! Dig out or die humble!",
      "She's coming down! Whatever you're doing, do it FASTER!",
      "Ceiling's voting no confidence! Feed that drill and GO!",
      "Full collapse! I got one cigarette of patience left. MOVE.",
    ],
    magmaSpread: [
      "Magma's creeping. Patient, hungry, hates belts. Like me.",
      "Lava took more floor. It doesn't file permits, kid. It eats.",
      "That orange stuff spreads. Don't garden near it.",
      "Magma on the move. The planet's blood, and it's LOOKING at us.",
    ],
    veinDepleted: [
      "Vein's dry. Sucked the marrow right out of her. Next.",
      "That vein's a memory now. Move the drill-head, pour one out.",
      "Ore's tapped. Company would say 'optimized'. I say 'empty'.",
      "Depleted. Even rocks quit on you eventually, kid.",
    ],
    breachReady: [
      "Floor's soft as a Company promise. PUNCH IT.",
      "Breach ready! Drill's drooling. Say the word and we drop.",
      "We're through the crust of it. One good push, kid. D for down.",
      "That's the breach bell! Grab your teeth, we're going deeper.",
    ],
    descend: [
      "Going down. Don't ask what's holding the walls. (Nothing is.)",
      "Dropping! If anyone asks, this was all Company-approved.",
      "Down we go, kid. The bottom's a rumor. Let's make it a fact.",
      "Descending. Hold something. Preferably something bolted.",
    ],
    overdriveOn: [
      "REDLINE, BABY! If she blows, I was never here.",
      "Overdrive! She likes it rough — the seismograph doesn't.",
      "Cranked to redline. Warranty's void. It was always void.",
      "Overdrive on. Every gauge is angry. That's how you know it works.",
    ],
    overdriveOff: [
      "Overdrive off. The rig's panting. Buy her dinner next time.",
      "Easing her down. Even I take a smoke break. Mid-shift, usually.",
      "Back to normal speed. Boring. Safe. Ugh.",
      "Overdrive off. The needles unclench. So do I.",
    ],
    repair: [
      "Patched her up. Duct tape counts as structure. Always has.",
      "Repaired. Hammer, spit, and a word I won't repeat. She'll hold.",
      "Good as new-ish. 'Ish' is Company standard, kid.",
      "Fixed. If it rattles, that's the machine saying thanks.",
    ],
    demolish: [
      "Torn down. Scrap's half price back. Company math, don't ask.",
      "Demolished. I love the smell of buyer's remorse in the deep.",
      "Scrapped it. She gave three whole minutes of service. Ingrate.",
      "Down she comes. Build, wreck, rebuild — it's called a career.",
    ],
    brokeAttempt: [
      "Can't afford it, kid. Plates don't grow on... anything down here.",
      "You're broke. Smelt more plates or start charming rocks.",
      "No plates, no toys. The Company store loves you like this.",
      "Empty pockets. My pension's got more in it, and it's imaginary.",
    ],
    schematicPick: [
      "New schematic installed. Bolted straight into the budget.",
      "Fancy tech. Somebody smart died making that. Use it well.",
      "Schematic's in. The rig purrs a little different now. Hear it?",
      "Upgrade wired in. Don't ask where the manual went. (Ate it.)",
    ],
    foundryBuy: [
      "Cores well spent. The Foundry never sleeps. Or refunds.",
      "Bolted on at the Foundry. She's uglier and better. Like me.",
      "New iron on the rig. Somewhere, a Company auditor faints.",
      "Upgrade's welded. Try to scratch it up real good down there.",
    ],
    death: [
      "Good news, kid: no more commute. Bad news: no more anything.",
      "Rig's gone. Twenty years I knew her. Rock took ten seconds.",
      "That's the shift, kid. Punch out. The planet punched first.",
      "We're done. Tell my pension I never believed in it either.",
    ],
    victory: [
      "You beautiful bastard. You actually drilled it.",
      "THE CORE, KID. Nobody drinks free off this story but us.",
      "Breached the gate. The Company owes you a moon. Take cash.",
      "We hit bottom and it hit back. And we WON. Hell of a shift.",
    ],
    mantleArrive: [
      "The Mantle. Past the maps, past the pension. Just us and heat.",
      "Nobody mines here, kid. Nobody sane. Good thing we're staffed.",
      "This deep, the rock remembers being a star. It's grumpy about it.",
      "The Mantle. Even my cough echoes wrong. Keep drilling.",
    ],
    jam: [
      "Line's backed up worse than the site latrine on chili night.",
      "Belts are jammed, kid. Somewhere an item lives its worst life.",
      "Output's plugged. Machines hate constipation same as we do.",
      "Jam on the line. Poke it. Percussive maintenance is real.",
    ],
    noCoal: [
      "Smelter's out of coal. It runs on coal, genius. COAL.",
      "No coal, no fire, no plates, no point. Feed the damn smelter.",
      "Smelter's cold as the Company's heart. Get some coal in her.",
      "Furnace is starving. Coal, kid. The black rocks. Chop chop.",
    ],
    lowIntegrity: [
      "Hull's holding on like my second marriage. Which is: it ain't.",
      "Integrity's under 30. She's held by rust and my good opinion.",
      "Hull's wheezing, kid. Patch something or start praying to rocks.",
      "Rig's critical. One more kiss from this planet, we're a plaque.",
    ],
    // M-RECAP: the Daily Shaft — one seed a day, naked rig, no Foundry.
    dailyStart: [
      "Daily shaft. Same hole as everybody else today. No toys. Prove it.",
      "One seed, one shot, no upgrades. Just you and an honest hole, kid.",
      "Today's shaft is open. Company logged the time. Make it look good.",
      "Naked rig, ranked run. This is the one they'll read out. Dig sharp.",
    ],
    dailyPractice: [
      "Practice run. Doesn't count, doesn't rank, doesn't fool me either.",
      "Second crack at today's shaft. Unranked. Warm up, kid, then sulk.",
      "This one's off the books. Like most of my best work, honestly.",
      "Practice. Your ranked time's already carved. Go on, chase it anyway.",
    ],
    idle: [
      "Napping, kid? The drill's tapping her foot. Learned it from me.",
      "Forty-five seconds of nothing. Union says I gotta yell: HEY.",
      "The rocks are aging, kid. So am I. Build something.",
      "Idle hands, empty drill. This ain't a scenic tour. Well. It is.",
    ],
    // M-GRITPLUS: the idle ladder. Rung 1 is `idle` above (a gentle rib);
    // these two are what he does when ribbing doesn't work.
    idle2: [
      "Ninety seconds. Should I hang a bird feeder off the drill, kid?",
      "Still nothing. I've seen faster geology. Literally. Just now.",
      "Take your time. The instability sure is taking hers.",
      "I'll just be over here. Aging. Audibly. Whenever you're ready.",
    ],
    idle3: [
      "Observe: the miner at rest. Motionless. Magnificent. Useless.",
      "Here we see the young foreman, waiting for the rock to blink first.",
      "In the wild, an unmoving miner is culled by the ceiling. Nature!",
      "Note the stillness of the species. Note also its short career.",
    ],
    // M-GRITPLUS: the smoke break. Fired by the engine off wall-clock pause
    // time (the sim is frozen), which is why both pools are priority.
    smokeBreak: [
      "Break's over when you say, kid. Rock's not going anywhere. Mostly.",
      "Take five. I'm taking six. Don't tell the Company either number.",
      "Standing around, are we. Good. My knees wanted a committee meeting.",
      "Nothing rusts faster for waiting down here. Except me. Carry on.",
    ],
    breakOver: [
      "Right. Where were we. Ah — the hole.",
      "Back on the clock. The hole missed you. Said so. Sort of mumbled it.",
      "Smoke's out, kid. So's my patience. Warm her up.",
      "There she is. Let's go bother the planet some more.",
    ],
    // M-GRITPLUS / EGG-420 — the Botanical Incident. For 42 seconds the bar
    // draws from here instead: same foreman, considerably fewer edges.
    egg420: [
      "...you ever really LOOK at a belt, kid? It just... goes.",
      "The quakes are just the planet's heartbeat, man.",
      "What if the ore WANTS to be plates. Ever think about that. Whoa.",
      "I'm not saying the drill has feelings. I'm not NOT saying it.",
      "This rock's four billion years old. We're the rude ones, kid.",
      "Time's a Company invention. Down here there's just... deep.",
      "Everything's a belt if you look at it long enough. Everything.",
      "Nobody can hear us this far down. Not even them. That's nice, huh.",
      "Hey. Hey, kid. A smelter is just a really committed campfire.",
      "If the stratum collapses and I'm mellow, does it even... yeah, no.",
    ],
    // M-WONDERS — the scan finds the stratum's landmark. The bespoke line per
    // wonder lives in LANDMARK_LINES below; this is the fallback, and it is
    // deliberately non-specific: GRIT has seen a shape on the scanner, not yet
    // whatever it turns out to be.
    landmarkFound: [
      "Scanner's got a shape out there. Too tidy. Nothing's tidy down here.",
      "Something's standing in my hole that I did not put in my hole.",
      "That reads solid on the sweep. Solid and OLD. Give it a wide berth.",
      "Huh. Somebody was here before the Company. Bet they billed less.",
      "Mark that on the map, kid. Then pretend you didn't see it. Dig.",
    ],
    // ...and what he says when the player actually touches one.
    landmarkUse: [
      "You poked it. Course you poked it. I'd have poked it too.",
      "Well, it did SOMETHING. Twenty years and that's still the review.",
      "Whatever you just woke up is your responsibility now, kid.",
      "Noted in the log as 'operator initiative'. That's a warning label.",
    ],
    egg420End: [
      "Break's over. Why does the copper smell like breakfast, kid?",
      "Whatever that was, it's wearing off. I'd fight a man for toast.",
      "Right. Back to work. Does this rig have a snack compartment? No?",
      "Clarity returns. So does the appetite. Mostly the appetite. Dig.",
    ],
  };

  // ---------------- M-CORELORE: the second voice ----------------
  // The Core is not GRIT and must never sound like him. It is lowercase, it is
  // unhurried, it has no tag and no jokes at its own expense — it finds YOU
  // funny. Render draws it in gold at half GRIT's typing speed, and every
  // Core line is authored with the deflection GRIT throws over the top of it,
  // because his answer is the character note: the profanity spikes when he's
  // scared. `core` is what the planet says; `grit` is what lands ~2s later.
  const CORE = {
    // stratum 6+, at most one per stratum: it has noticed you
    intrusion: [
      { core: "warmer.",
        grit: "Rock settles, kid. Rock's always settled. Eyes on the drill." },
      { core: "you knock so politely.",
        grit: "Who the hell said that. Nobody said that. Feed the damn drill." },
      { core: "the last one stopped at seven. you won't.",
        grit: "Static. Bad cable. Twenty years of bad cable. Keep digging." },
      { core: "i have been counting your gears.",
        grit: "That's it, I'm docking the intercom. Ignore it. Hands moving." },
      { core: "little machine. little hands. keep going.",
        grit: "Don't answer that. You answer it, it learns your voice. DIG." },
      { core: "you smell of sunlight. i remember sunlight.",
        grit: "Nope. No thank you. That's a nope from me and from the union." },
      { core: "there is a shape inside you i recognise.",
        grit: "It's talking to YOU now? Wonderful. Faster, kid. Much faster." },
      { core: "your rig is very loud for a thing so temporary.",
        grit: "Twenty damn years and nothing ever insulted my rig like that." },
      { core: "yes. bite harder. i like the noise.",
        grit: "Whatever enjoys the noise gets silence. Ease off the redline." },
      { core: "no one has ever come this deep carrying a lunchbox.",
        grit: "It's a THERMOS, and I'll be damned if the floor gets opinions." },
      { core: "i felt that one. do it again.",
        grit: "It LIKED that. Kid, it liked that. I hate this shift. Onward." },
      { core: "the dark here is not empty. it is only patient.",
        grit: "Real cheerful. Somebody invoice the planet for my nerves." },
    ],
    // stratum 8, the Core Gate: three beats at 25% / 60% / 95% of the breach
    // feed. Ask, offer, laugh. Beat 2 puts a fake ASCEND prompt on the screen.
    gate: [
      { core: "stop. i was sleeping so well under all this weather.",
        grit: "The FLOOR is giving orders now. Keep feeding her, kid. Ignore." },
      { core: "you are tired. the sky is still up there. go on. take it.",
        grit: "Don't you touch that. It's lying. Probably. Drill.", offer: true },
      { core: "oh. you meant it. hah. hah. the little thing meant it.",
        grit: "That's a laugh. That thing LAUGHED. Hazard pay. Now. DRILL!" },
    ],
    // the victory screen, the moment the shell opens. GRIT has just finished
    // his toast; this is what answers it, and then what he says about that.
    // The crack alone is a picture — this is the picture landing.
    reveal: [
      { core: "thank you. it was getting so tight in here.",
        grit: "...Kid. Kid, the hole is talking. The HOLE is TALKING. Back up." },
      { core: "you opened it from the outside. how kind of you.",
        grit: "We didn't drill a bottom. We drilled a doorbell. Oh, hell." },
      { core: "shhh. i am still coming out.",
        grit: "Nope. Bonus declined. Whatever that is, it can keep the core." },
    ],
    // the Mantle: past the shell, and done being entertained
    mantle: [
      { core: "you are inside now. mind the walls. the walls are mine.",
        grit: "Kid — whatever that is, it stopped being funny two floors up." },
      { core: "you cracked my door. now the door knows your face.",
        grit: "I got nothing for that one. First time my mouth ever quit." },
      { core: "there is no down remaining. only in. you are welcome in.",
        grit: "Just dig. Don't listen. I'll handle the conversation, kid." },
    ],
  };

  // M-WONDERS: one bespoke line per landmark, keyed by the id in
  // D.LANDMARKS. `find` is the sweep spotting it; `use` is the player having
  // done the thing to it. Every landmark has a find line; only the ones you
  // can touch have a use line.
  const LANDMARK_LINES = {
    anvil: { find: "That's an anvil. Somebody's forge, and the heat never left." },
    drowned: {
      find: "Big dead pump out there. Pre-collapse. They built 'em heavy.",
      use: "She's old. She naps. Respect it and she'll chew for you.",
    },
    warmspot: { find: "Floor's warm on the west read. Warm floor doesn't shake." },
    glassforest: {
      find: "Glass trees. Whole forest of 'em. Don't lean on the scenery.",
      use: "Chopped a spire. That's a crystal, kid, and it cost you a wrist.",
    },
    seal: {
      find: "Company seal on a hatch. Means somebody locked something IN.",
      use: "Cracked it. Your file just grew a paragraph. Hope it was worth it.",
    },
    bell: {
      find: "Bronze dome. Big as a cab. Nobody builds a bell for nothing.",
      use: "You RANG it. Every seam here just woke up. So did something else.",
    },
    mirror: {
      find: "Black water, flat as a ledger. Never trust a flat thing.",
      use: "Sweep bounced clean off. Free survey. I'll take free.",
    },
    root: { find: "That column runs to the mantle. The planet braces on it." },
  };

  // Bespoke arrival line per stratum (1-8) + mantle.
  const STRATUM_LINES = {
    1: "Topsoil. My gran dug harder dirt with a spoon. Warm up, kid.",
    2: "Sandstone. Buried wind, they say. Smells like ghosts and grit.",
    3: "Karst hollows. Water dug these graves first. We're just visiting.",
    4: "Granite root. The mountain's spine. We're here to slip a disc.",
    5: "Glowdeep. If it shines, it sells. If it hums, don't lick it.",
    6: "Magma fringe. Floor's literally lava. Insurance won't answer.",
    7: "Obsidian warrens. Glass walls, no echoes. Even I'm whispering.",
    8: "The Core Gate. It knows we're here. Knock with the big drill.",
    mantle: "The Mantle. No map, kid. Nobody came back to draw one.",
  };

  // Bespoke line per schematic id (14).
  const SCHEM_LINES = {
    s_beltfree: "Free belts! Frictionless rollers — like my career, no traction.",
    s_extract: "Twin Drill-Heads, eh? One for work, one for the weekend.",
    s_smelt: "Blast furnaces. Now the ore's scared BEFORE it goes in.",
    s_coal: "Coal scrubbers. Half the soot, twice the smug. My lungs weep.",
    s_plate: "Extra hull plate. Like a beer gut, but useful in a fight.",
    s_damp: "Seismic dampers. The planet still hates us — quieter, though.",
    s_repair: "Repair swarm. Little bots doing my job. I taught 'em the spit.",
    s_drill: "Diamond bit. Puttin' rich-lady jewelry to honest work.",
    s_salvage: "Salvage claws. We loot our own base on the way out. Classy.",
    s_survey: "Deep sonar. Now we see the bad news before we step in it.",
    s_charge: "Resonant charges. Double the boom per boom. Physics owes us.",
    s_over: "Overdrive coupling. Redline's cheaper now. My kind of discount.",
    s_veins: "Rich veins ahead. The planet's wallet is open, kid. Reach in.",
    s_gear: "Bronze gearworks. Two metals, one gear, zero patents. Beautiful.",
  };

  // Bespoke line per Foundry meta upgrade id (9).
  const META_LINES = {
    m_stock: "Deeper stores. More plates up front. Spend 'em like you hate 'em.",
    m_hull: "Reinforced hull. She takes a punch now. So stop feeding her one.",
    m_damp: "Gyro dampers. The shakes stay in my hands, where they belong.",
    m_torque: "More torque. She bites faster and swallows faster. Hot damn.",
    m_fix: "Field kits. One-plate repairs. Duct tape, industrialized.",
    m_scan: "Prospector array. See farther, disappoint faster.",
    m_salv: "Salvage rig. Nothing we build stays buried. Except coworkers.",
    m_deep: "Deep stock. Copper and charges on day one. Feels like cheating.",
    m_schem: "Schematic library. Four choices now. Look at you, kid — options.",
  };

  // Gameover epitaphs, cause-aware: each entry is 1-2 lines.
  const EPITAPHS = {
    magma: [
      ["Buried in the melt, kid. The planet took us like cheap solder.",
       "Closed casket. Open flame. Company sends thoughts, not prayers."],
      ["The lava was patient and we weren't. That's the whole obituary.",
       "Rest easy. You're the shiniest part of this stratum now."],
      ["Magma got the rig. It doesn't chew, kid. It just swallows.",
       "On the bright side: cremation's free down here."],
    ],
    quake: [
      ["The hull gave. Quakes always collect, kid. With interest.",
       "We died as we lived: ignoring the seismograph."],
      ["Integrity zero. The stratum wanted a hug. It got a rig.",
       "The Company will name a memo after you."],
      ["She rattled apart around us. Good rig. Bad planet.",
       "Somewhere up top, my pension just laughed."],
    ],
    abandon: [
      ["Pulled the plug, huh. Smart. Dead miners don't unionize.",
       "The deep keeps the deposit. It always does."],
      ["We walked. First rule of mining: know when the hole wins.",
       "Don't sulk, kid. The core's not going anywhere. Sadly."],
      ["Abandoned the dig. My lungs thank you. My pride abstains.",
       "Surface air. Weird stuff. Doesn't even taste like coal."],
    ],
  };

  // ---------- GRIT's Performance Review (SPEC3 M-RECAP) ----------
  // One line on the recap card at the end of every run, tiered by how it
  // ended. This is the reward: the card is the artifact, the roast is why you
  // read it. Tokens in {braces} are filled from the finished run, so the line
  // knows what you actually did — a hoarder gets the hoarding joke.
  // Tokens: depth time min plates gears charges cores breaches schems
  const REVIEWS = {
    shallow: [
      "Stratum {depth}. The topsoil's still warm and you're already a fossil.",
      "Depth {depth}, kid. My gran's compost heap runs deeper than that.",
      "{min} minutes for stratum {depth}. Snails file better mileage, kid.",
      "We died under the parking lot. Genuinely. The parking lot.",
      "Banked {plates} plates and no hole worth the name. Nice hoarding.",
      "Surface casualty. The Company files these under 'stationery'.",
      "That was a pothole with ambition. Try leaving one behind, kid.",
      "{gears} gears fed. Drill's still hungry and now so are the worms.",
      "Rookie depth. Cheer up — this rock forgets faster than I do.",
      "Shallow end, kid. They can still hear you screaming from up top.",
    ],
    mid: [
      "Depth {depth}. My nephew got to 4 his first week. He's an idiot, kid.",
      "Halfway to somewhere. The Company calls that 'promising trajectory'.",
      "Stratum {depth}, {min} min. Fine work don't get statues though, kid.",
      "You died with {plates} plates banked. Saving for retirement? Down HERE?",
      "Middle depth, middle time. You're management material, and I'm sorry.",
      "Stratum {depth} is where the rock quits being polite. It showed, huh.",
      "{gears} gears, {breaches} floors. Solid shift. Solid ain't deep, kid.",
      "Not bottom, not bad. The core never even looked up from its work.",
      "You cleared the easy dirt. Then the dirt made its counter-argument.",
      "{schems} schematics recovered and you still parked at {depth}. Ouch.",
    ],
    deep: [
      "Stratum {depth}. That's real mining. Wear a hard hat next time. HARD.",
      "{min} minutes where the rock glows. Few get there. Fewer walk back.",
      "Depth {depth} and the heat got a vote. I'd have voted the same way.",
      "You went deep enough to spook me, and I'm already hollowed out.",
      "{gears} gears into that throat. She swallowed every one, then you.",
      "Almost, kid. 'Almost' is what they carve on the expensive headstones.",
      "That's a career-ending depth. Your career ended. The depth's fine.",
      "At {depth} the Company stops sending memos. Take the compliment.",
      "You had {plates} plates and nowhere left to spend 'em. Deep problem.",
      "Stratum {depth}. I felt that one through my boots from the surface.",
    ],
    win: [
      "A win's a win. Don't let it get around that it took you {min} minutes.",
      "Core breached in {time}. I've seen faster. I've seen nobody, mostly.",
      "You drilled through the bottom of a planet. Put THAT on a resume.",
      "Deepest hole on the payroll, {time} flat. Your name's scratched in it.",
      "Won it. The Company will bill you for the hole. Frame the invoice.",
      "Clean descent. I'd call it luck, but I watched the whole damn thing.",
      "Core's punched. Somewhere an executive is having a terrible morning.",
      "{time} to the bottom. My whole career was slower AND shallower.",
      "You made it. I retire on this story, so quit while I still look good.",
      "Victory, and {cores} cores to spend. Buy something obscenely loud.",
    ],
    mantle: [
      "Past the core, into the Mantle. Stratum {depth}. There's no bottom.",
      "The Mantle collected you at {depth}. It collects everybody, kid.",
      "You won and kept digging. That's not bravery, that's a condition.",
      "{min} minutes past the end of every map. Nobody charts that but us.",
      "Depth {depth} in the deep heat. The planet knows your name now. Badly.",
      "Mantle run. The stone hums down there and you went to argue with it.",
      "Had a win in your pocket and spent it on {depth}. Respect, you fool.",
      "Stratum {depth}. Past here the Company hasn't even printed a form.",
      "{gears} gears burned in the Mantle. That's a bonfire, not a shift.",
      "Died rich and unreasonably deep. Best kind there is. Sleep warm, kid.",
    ],
  };

  // Victory screen toast lines.
  const TOASTS = [
    "Core breached. First round's on the Company — I stole their card.",
    "They said the bottom was a myth, kid. You made it a doorstep.",
    "Drilled to the damn core. Retire? Nah. There's always deeper.",
  ];

  // Full trigger catalog (SPEC2 §A.2) — every id has a pool above.
  const TRIGGERS = Object.keys(POOLS);

  // ---------------- per-run state ----------------
  function stateOf(run) {
    if (!run._barks) {
      run._barks = {
        lastAt: -COOLDOWN,   // run.totalT of last bark (allow one at t=0)
        used: {},            // line text -> true (once-per-run)
        queue: [],           // pending discrete triggers awaiting cooldown
        queued: {},          // trigger -> true while in queue (dedupe)
        depth: run.depth,    // last seen depth (stratumArrive detection)
        firsts: {},          // first* triggers already handled
        jamActive: false,
        noCoalActive: false,
        lowIntFired: false,  // once per stratum
        idleAnchor: 0,       // totalT of last idle bark
        idleRung: 0,         // M-GRITPLUS: which rung of the idle ladder is spent
        coreSaid: false,     // M-CORELORE: the Core has intruded this stratum
        corePend: null,      // { line, at } — GRIT's deflection, already chosen
        coreBeats: {},       // gate beat -> true (each fires once per run)
        eggAt: 0,            // EGG-420: totalT of the last mellow line
        eggEnded: 0,         // EGG-420: totalT of the window we already closed
      };
    }
    return run._barks;
  }

  function bespokeFor(run, trigger, ctx) {
    if (trigger === 'stratumArrive')
      return run.depth <= D.STRATA_COUNT ? STRATUM_LINES[run.depth] : STRATUM_LINES.mantle;
    if (trigger === 'mantleArrive') return STRATUM_LINES.mantle;
    if (trigger === 'schematicPick' && typeof ctx === 'string') return SCHEM_LINES[ctx] || null;
    if (trigger === 'foundryBuy' && typeof ctx === 'string') return META_LINES[ctx] || null;
    // M-WONDERS: ctx is the landmark id; the generic pool covers the rest.
    if ((trigger === 'landmarkFound' || trigger === 'landmarkUse') &&
        typeof ctx === 'string') {
      const L = LANDMARK_LINES[ctx];
      return (L && L[trigger === 'landmarkFound' ? 'find' : 'use']) || null;
    }
    return null;
  }

  function pickLine(run, S, pool) {
    const fresh = pool.filter(l => !S.used[l]);
    const arr = fresh.length ? fresh : pool;  // pool exhausted -> allow reuse
    return arr[Math.floor(run.rng() * arr.length)];
  }

  // `voice` is 'grit' (default) or 'core'. The Core's line is not tagged, holds
  // longer and is typed at half speed by render — it is in no hurry, and the
  // reader needs a beat to notice the bar changed character.
  function say(run, S, line, voice) {
    S.used[line] = true;
    S.lastAt = run.totalT;
    const core = voice === 'core';
    // ~7s hold; long lines linger (typewriter reveals 2 chars/tick, 1 for the
    // Core, so its hold covers a full-length reveal plus a beat to read it).
    const dur = core
      ? (D.CORE ? D.CORE.hold : 9) * HZ + line.length
      : 7 * HZ + Math.ceil(Math.max(0, line.length - 40) / 2);
    run.foreman = { text: line, t0: run.totalT, until: run.totalT + dur,
                    voice: core ? 'core' : 'grit' };
    if (run.messages) { // mirror into the LOG, dim (SPEC2 §F)
      run.messages.push({
        text: (core ? '  ▸ ' : 'GRIT ▸ ') + line,
        color: core ? D.COLORS.gold : D.COLORS.darkgray, t: run.t,
      });
      if (run.messages.length > 40) run.messages.shift();
    }
    return line;
  }

  // ---------------- EGG-420 ----------------
  // sim.js owns the window (run.egg = { until, src } in run.totalT); barks only
  // asks whether it is open. Absent egg state = closed, always.
  function eggOpen(run) {
    return !!(run && run.egg && run.totalT < run.egg.until);
  }

  // ---------------- API ----------------
  function fire(run, trigger, ctx) {
    if (!run || !run.rng || !POOLS[trigger]) return null;
    const S = stateOf(run);
    if (!PRIORITY[trigger]) {
      // bigQuake may supersede the plain quake bark fired this same tick
      // (engine barks 'quake' from run.shake before draining events).
      const sameTick = trigger === 'bigQuake' && S.lastAt === run.totalT;
      // schematicPick always lands: run.totalT freezes across the descend
      // screen, so the descend-time bark would otherwise swallow every
      // bespoke pick line for the whole run (arrival cut-in, not spam —
      // the engine only fires it when a new stratum begins).
      const cutIn = trigger === 'schematicPick';
      if (!sameTick && !cutIn && run.totalT - S.lastAt < COOLDOWN) return null;
    }
    // EGG-420: while the window is open the bar is mellow about EVERYTHING.
    // Priority triggers (death, victory, collapse, breachReady) still say what
    // they came to say — the joke never costs the player information they need.
    if (eggOpen(run) && !PRIORITY[trigger] && POOLS.egg420 &&
        trigger !== 'egg420' && trigger !== 'egg420End') {
      return say(run, S, pickLine(run, S, POOLS.egg420));
    }
    const b = bespokeFor(run, trigger, ctx);
    const line = (b && !S.used[b]) ? b : pickLine(run, S, POOLS[trigger]);
    return say(run, S, line);
  }

  // ---------------- M-CORELORE API ----------------
  // One entry point for every Core register: 'intrusion' (stratum 6+ ambient),
  // 'gate' (with ctx = the beat index 0..2), 'reveal' (the opened shell, drawn
  // by render on the victory screen) and 'mantle'. The Core always cuts in —
  // it does not queue behind GRIT's cooldown, it interrupts him, and his
  // paired deflection is scheduled for the moment its line finishes typing.
  function coreSpeak(run, kind, ctx) {
    if (!run || !run.rng) return null;
    const pool = CORE[kind];
    if (!Array.isArray(pool) || !pool.length) return null;
    const S = stateOf(run);
    let pair;
    if (kind === 'gate') {
      const i = Math.max(0, Math.min(pool.length - 1, ctx | 0));
      if (S.coreBeats[i]) return null;         // one beat, once, per run
      S.coreBeats[i] = true;
      pair = pool[i];
    } else {
      const fresh = pool.filter(p => !S.used[p.core]);
      const arr = fresh.length ? fresh : pool;
      pair = arr[Math.floor(run.rng() * arr.length)];
      // M-WONDERS rings The Bell early and the Core answers it, which spends
      // this floor's one intrusion — otherwise the ambient roll could speak
      // again minutes later and the "at most one per stratum" rule would be
      // true only when nobody touched anything.
      if (kind === 'intrusion' || kind === 'mantle') S.coreSaid = true;
    }
    if (!pair) return null;
    const line = say(run, S, pair.core, 'core');
    // The fake [ENTER] ASCEND prompt (gate beat 2). Render reads run.coreOffer
    // and draws a prompt that does absolutely nothing — the Core is lying, and
    // GRIT says so a beat later. No key is rebound; pressing ENTER under it
    // does exactly what ENTER always does.
    if (pair.offer) {
      run.coreOffer = { t0: run.totalT, until: run.totalT + (D.CORE ? D.CORE.offer : 9) * HZ };
    }
    if (pair.grit) S.corePend = { line: pair.grit, at: run.totalT + line.length + 2 * HZ };
    return line;
  }

  function tick(run) {
    if (!run || !run.rng) return;
    const S = stateOf(run);
    // foreman expiry: hold until `until`, render fades 2s, then clear.
    if (run.foreman && run.totalT > run.foreman.until + 2 * HZ) run.foreman = null;
    if (run.status !== 'active' && run.status !== 'breachReady') return;

    // stratum arrival (engine doesn't fire these; detect the depth change)
    if (run.depth !== S.depth) {
      S.depth = run.depth;
      S.lowIntFired = false;   // lowIntegrity is once per stratum
      S.jamActive = false;     // machines were rebuilt; re-arm ambients
      S.noCoalActive = false;
      S.coreSaid = false;      // the Core may speak once on this floor
      S.idleRung = 0;
      enqueue(S, run.depth > D.STRATA_COUNT ? 'mantleArrive' : 'stratumArrive');
    }

    // M-CORELORE: GRIT's paired deflection, landing as the gold line finishes
    // typing. It is not queued behind the cooldown — being interrupted by the
    // planet is exactly when he talks over things.
    if (S.corePend && run.totalT >= S.corePend.at) {
      const pend = S.corePend;
      S.corePend = null;
      say(run, S, pend.line);
    }

    // M-CORELORE: the ambient intrusion. Stratum 6 and below, once per floor,
    // rare, and never before the floor has had time to feel normal. Deep in
    // the Mantle it stops being amused and draws from the other pool.
    const CFG = D.CORE;
    if (CFG && !S.coreSaid && !S.corePend && run.depth >= CFG.depth &&
        run.t > CFG.armT * HZ && run.rng() < CFG.chance) {
      S.coreSaid = true;
      coreSpeak(run, run.depth > D.STRATA_COUNT ? 'mantle' : 'intrusion');
    }

    // first placements / first gear (via run.stats + machine scan)
    const placed = (run.stats && run.stats.placed) || {};
    checkFirst(S, placed.belt, 'firstBelt');
    checkFirst(S, placed.extractor, 'firstExtractor');
    checkFirst(S, placed.smelter, 'firstSmelter');
    checkFirst(S, placed.assembler, 'firstAssembler');
    if (!S.firsts.firstGear && run.machines) {
      for (const id in run.machines) {
        const m = run.machines[id];
        if (m && m.type === 'assembler' && m.job && D.RECIPES[m.job] &&
            D.RECIPES[m.job].out.gear) {
          S.firsts.firstGear = true;
          enqueue(S, 'firstGear');
          break;
        }
      }
    }

    // flush one queued discrete trigger once the cooldown clears
    if (S.queue.length && run.totalT - S.lastAt >= COOLDOWN) {
      const t = S.queue.shift();
      delete S.queued[t];
      fire(run, t);
    }

    // ---- ambients (retry while the condition holds, debounced) ----
    // jam: any machine blocked > 10s (blockedSince is run.t, stratum-local)
    let jammed = false, starving = false;
    if (run.machines) {
      for (const id in run.machines) {
        const m = run.machines[id];
        if (!m || m.id === 0) continue;
        if (m.blockedSince > 0 && run.t - m.blockedSince > 10 * HZ) jammed = true;
        if (m.type === 'smelter' && m.nofuelSince > 0 &&
            run.t - m.nofuelSince > 8 * HZ) starving = true;
        if (jammed && starving) break;
      }
    }
    if (jammed) { if (!S.jamActive && fire(run, 'jam')) S.jamActive = true; }
    else S.jamActive = false;
    if (starving) { if (!S.noCoalActive && fire(run, 'noCoal')) S.noCoalActive = true; }
    else S.noCoalActive = false;

    // lowIntegrity: < 30, once per stratum
    if (!S.lowIntFired && run.integrity > 0 && run.integrity < 30) {
      if (fire(run, 'lowIntegrity')) S.lowIntFired = true;
    }

    // EGG-420: the window drips a mellow line every ~14s of its 42, and closes
    // with the munchies. `eggEnded` keys on the window's own expiry stamp, so
    // a second tin later in the run gets its own exit line.
    const EG = D.EGG420;
    if (EG && run.egg) {
      if (eggOpen(run)) {
        if (run.totalT - S.eggAt > EG.barkEvery * HZ && fire(run, 'egg420'))
          S.eggAt = run.totalT;
      } else if (S.eggEnded !== run.egg.until) {
        // retried until it lands: if the cooldown swallows the exit line the
        // window closes with no comment, which is the one beat it needs
        if (fire(run, 'egg420End')) S.eggEnded = run.egg.until;
      }
    }

    // idle: the M-GRITPLUS ladder — 45s gentle rib, 90s sarcasm, 150s nature
    // documentary. Each rung fires once per idle episode; any placement or
    // drill feed resets the whole ladder.
    if (run.stats) {
      const act = Math.max(run.stats.lastPlaceT || 0, run.stats.lastFeedT || 0);
      if (act > S.idleAnchor) { S.idleAnchor = act; S.idleRung = 0; }
      const LAD = D.IDLE_LADDER || [45];
      const idleFor = run.totalT - S.idleAnchor;
      if (S.idleRung < LAD.length && idleFor > LAD[S.idleRung] * HZ) {
        const rung = ['idle', 'idle2', 'idle3'][S.idleRung] || 'idle';
        if (fire(run, POOLS[rung] ? rung : 'idle')) S.idleRung++;
      }
    }
  }

  // M-GRITPLUS: the smoke break. The sim is frozen while the game is paused,
  // so run.totalT does not move — which would leave the typewriter stuck on
  // zero characters and the line pinned to the bar forever. Both are handled
  // here: the reveal is back-dated so the line is already fully typed, and the
  // hold is short enough that resuming clears it. Engine-driven off the
  // wall clock; `kind` is 'smokeBreak' or 'breakOver'.
  function pause(run, kind) {
    if (!run || !run.rng || !POOLS[kind]) return null;
    const S = stateOf(run);
    const line = say(run, S, pickLine(run, S, POOLS[kind]));
    const f = run.foreman;
    if (f) {
      f.t0 = run.totalT - Math.ceil(line.length / 2) - 1;   // already typed out
      f.until = run.totalT + 6 * HZ;
    }
    return line;
  }

  function enqueue(S, trigger) {
    if (S.queued[trigger]) return;
    S.queued[trigger] = true;
    S.queue.push(trigger);
  }

  function checkFirst(S, count, trigger) {
    if (!S.firsts[trigger] && count > 0) {
      S.firsts[trigger] = true;
      enqueue(S, trigger);
    }
  }

  // Gameover lines. Cause-aware: abandoned (integrity intact) vs melted in a
  // magma stratum vs shaken apart. Deterministic via run.rng.
  function epitaph(run) {
    let cause = 'quake';
    if (run && run.integrity > 0) cause = 'abandon';
    else if (run) {
      const S = run.depth <= D.STRATA_COUNT
        ? D.STRATA[run.depth - 1] : D.mantleStratum(run.depth);
      if (S.features && S.features.magma) cause = 'magma';
    }
    const pool = EPITAPHS[cause];
    const i = run && run.rng ? Math.floor(run.rng() * pool.length) : 0;
    return pool[i].slice();
  }

  function toast(run) {
    const i = run && run.rng ? Math.floor(run.rng() * TOASTS.length) : 0;
    return TOASTS[i];
  }

  // ---------------- performance review (SPEC3 M-RECAP) ----------------
  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Which pool the run earned. A Mantle run is judged as a Mantle run even
  // though it also won, because that is the more interesting fact about it.
  function reviewTier(run, result) {
    const res = result || (run && run.result) || {};
    const depth = res.depth || (run && run.depth) || 1;
    if (run && run.mantle) return 'mantle';
    if (res.won) return 'win';
    if (depth >= 6) return 'deep';
    if (depth >= 3) return 'mid';
    return 'shallow';
  }

  // Facts the roast can reach for. gearsFed/chargesFed reset every stratum, so
  // the run totals come from the engine's per-stratum splits plus whatever the
  // current stratum had banked when it ended (absent splits = current only).
  function reviewCtx(run, result) {
    const res = result || (run && run.result) || {};
    const inv = (run && run.inv) || {};
    let gears = (run && run.gearsFed) || 0;
    let charges = (run && run.chargesFed) || 0;
    const splits = (run && Array.isArray(run.splits)) ? run.splits : [];
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      if (!s) continue;
      gears += s.gears || 0;
      charges += s.charges || 0;
    }
    const sec = typeof res.timeSec === 'number' ? res.timeSec
      : Math.round(((run && run.totalT) || 0) / HZ);
    return {
      depth: res.depth || (run && run.depth) || 1,
      time: mmss(sec),
      min: Math.max(1, Math.round(sec / 60)),
      plates: Math.floor(inv.ironPlate || 0),
      gears: gears, charges: charges,
      cores: res.cores || 0,
      breaches: res.breaches || (run && run.breaches) || 0,
      schems: ((run && run.schematics) || []).length,
    };
  }

  function fillReview(line, ctx) {
    return String(line).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k]) : m;
    });
  }

  // The review is the one bark RENDER asks for on demand: the recap card is a
  // screen the player may or may not open, and may open at any frame. Every
  // other pool is rolled from run.rng inside the game loop, where the draw
  // happens for everyone at the same point in the sequence — but a draw made
  // here would only happen for the player who pressed TAB, and on the victory
  // screen the run is still live: one stolen number changes the Mantle's
  // schematic offers AND its map generation. So this pool is picked by a pure
  // hash of the run's seed and its outcome instead. run.rng is never advanced,
  // the roast is the same roast whether or not you ever look at the card, and
  // it is still per-run and unpredictable. (SPEC3 rule 4: render must never
  // feed back into sim.)
  function reviewPick(run, tier, ctx) {
    let h = 0x811c9dc5;
    const s = String((run && run.seed) >>> 0) + '|' + tier + '|' + ctx.depth;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 1);
  }

  function review(run, result) {
    const tier = reviewTier(run, result);
    const pool = REVIEWS[tier] || REVIEWS.shallow;
    const ctx = reviewCtx(run, result);
    return fillReview(pool[reviewPick(run, tier, ctx) % pool.length], ctx);
  }

  DC.Barks = {
    tick: tick, fire: fire, epitaph: epitaph, toast: toast,
    // M-CORELORE / M-GRITPLUS
    core: coreSpeak, pause: pause, eggOpen: eggOpen, CORE: CORE,
    // M-RECAP
    review: review, reviewTier: reviewTier, reviewCtx: reviewCtx,
    fillReview: fillReview, REVIEWS: REVIEWS,
    // data exposed for the headless acceptance test (SPEC2 §G)
    POOLS: POOLS, STRATUM_LINES: STRATUM_LINES, SCHEM_LINES: SCHEM_LINES,
    META_LINES: META_LINES, EPITAPHS: EPITAPHS, TOASTS: TOASTS,
    LANDMARK_LINES: LANDMARK_LINES,   // M-WONDERS
    TRIGGERS: TRIGGERS, COOLDOWN: COOLDOWN, PRIORITY: PRIORITY,
  };
})();
