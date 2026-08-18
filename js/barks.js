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
    // M-MANTLE: the generic shrug, for the day a mutator ships before its
    // bespoke line does. bespokeFor prefers MUTATOR_LINES for every id in
    // data.js, so in a green tree this pool is a safety net and not a voice.
    mutator: [
      "This floor's got a personality. They all do. None of 'em nice.",
      "Something's off down here. Read the banner. I'm not reading it twice.",
      "Every floor past eight has a rule. Learn it or wear it, kid.",
      "The Mantle's dealing again. Check what it dealt us.",
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
    // M-EVENTS — what the rock had in it. The finds that PAY share one pool
    // (an ore pocket and a plate cache are the same shrug in his mouth); the
    // four that pay nothing but story get their own, because that story is
    // the entire reason they exist.
    digFind: [
      "Rock owes us about nine years. Rock just paid a Tuesday.",
      "Free material out of a hole. Rare. Take it and say nothing.",
      "Well, look at that. The seam had a conscience after all.",
      "Log it under 'found'. The Company reads 'found' as 'theirs'.",
      "Somebody left that behind. Their loss, our shift bonus, kid.",
      "Twenty years and the rock still hands me presents. Suspicious.",
    ],
    lunchbox: [
      "A lunchbox. Sealed. Somebody meant to come back for that one.",
      "Don't open it. I opened one on four. I still think about it.",
      "That's a Halloran box. Man packed a thermos every single shift.",
      "Empty belly, full box. The deep's idea of a punchline, that.",
      "Leave it where he set it down. He's owed that much, at least.",
      "Old foreman told me: never eat what the rock kept. He was thin.",
    ],
    bones: [
      "Somebody stopped here. Boots off. He knew he was stopping.",
      "Say nothing, dig on. That's the whole funeral we can afford.",
      "Hard hat still on him. Regulations to the last, the poor sod.",
      "That's no fossil, kid. Fossils are older than the Company.",
      "Every seam down here is somebody's last address. Mind yours.",
    ],
    gasPocket: [
      "HISS. Down— right. Pressure's up. Breathe through your teeth.",
      "Pocket gas. Sour, ancient, furious, and ours now. Wonderful.",
      "The whole seam just exhaled on us. Charming. Keep drilling.",
      "For the file: the planet burps. The gauge agrees with me.",
      "Everybody smell that? Good. Means you're still breathing.",
    ],
    oldShaft: [
      "Somebody dug that before us. Scan's running down it. Free map.",
      "An old shaft means an old crew. Look, learn, do NOT linger.",
      "That hole goes further than our paperwork does. Eyes forward.",
      "Company says these shafts don't exist. Company says a lot.",
      "Free survey, courtesy of a dead man. Thank him by moving fast.",
    ],
    deadRig: [
      "Another rig. Strip her. She'd rather work than rust, that one.",
      "Twelve plates and a last log entry. That's a career, kid.",
      "Read what he wrote. Then dig faster. That's how you thank him.",
      "Poor bastard got this far. We go further. Feed the drill.",
      "It isn't grave-robbing if you leave the name plate bolted on.",
    ],
    // M-EVENTS — the expedition vignettes. GRIT does not narrate the event
    // (the rock does that, in events.js); he editorialises the CHOICE, a beat
    // after you have made it. The bespoke line per choice is in
    // VIGNETTE_LINES below; this is the fallback for anything unwritten.
    // M-EVENTS — the cave-cat. He is not a cat person. He is, demonstrably,
    // a cat person.
    cat: [
      "There's a cat on my rig. Fine. She's crew. Don't tell payroll.",
      "Cat's asleep on a live smelter. Best safety officer we've had.",
      "She washed her face at me. I think that's a performance review.",
      "Name her whatever you like, kid. She already named herself.",
      "Twenty years down here and the CAT gets the warm seat. Typical.",
    ],
    catFlee: [
      "Cat's running. CAT'S RUNNING. Brace for it, kid, she's never wrong.",
      "She just bolted for the rig. Whatever she heard, it's coming.",
      "Watch the cat, not the gauge. The cat is the gauge. Hold on.",
      "That's her tell. Two seconds. Grab something bolted down.",
    ],
    vignette: [
      "Whatever you just decided, it's in the log as YOUR decision.",
      "Nobody has ever come back to tell me which one was correct.",
      "Fine. Done is done. The drill doesn't care either way. Move.",
      "Every crew that stood there picked one. Most of them were wrong.",
      "That's the thing about a fork, kid. You only get the one leg.",
    ],
    egg420End: [
      "Break's over. Why does the copper smell like breakfast, kid?",
      "Whatever that was, it's wearing off. I'd fight a man for toast.",
      "Right. Back to work. Does this rig have a snack compartment? No?",
      "Clarity returns. So does the appetite. Mostly the appetite. Dig.",
    ],
    // ---- M-ONBOARD: GRIT's last word on a fault the SIM has already named ----
    // sim.js has said, plainly, what is wrong and how to fix it. These come
    // AFTER that, and they carry no information at all — law 3 says GRIT does
    // not explain mechanics, and law 6 says the boring sentence lands first.
    // If a player has to parse one of these to learn why their base is stopped,
    // the brief failed. Read them with the log line deleted: they should still
    // be funny and still be useless, which is the whole job.
    //
    // Four causes only. 'blocked', 'nofuel' and 'depleted' already reach him
    // through the jam / noCoal / veinDepleted pools, and two GRIT lines about
    // one fault is nagging.
    diagBeltJam: [
      "That belt delivers to nobody. Very Company. Very on-brand.",
      "Line ends in dirt, kid. The dirt has never once paid us.",
      "Something on that line has been waiting long enough to vest.",
      "Cargo with no address. Bold. Stupid, but bold.",
    ],
    diagStarved: [
      "Assembler's sat there empty-handed like a foreman on payday.",
      "It's got the recipe and no groceries. I know the feeling.",
      "That thing isn't lazy, kid. Nobody brought it anything to do.",
      "An idle assembler is just an expensive table. Ours is very expensive.",
    ],
    diagStallGear: [
      "Rig's chewing air. Twenty years, it has never skipped a meal quietly.",
      "The drill is spinning and judging us. Mostly you, but us.",
      "She's hungry, kid, and rock is not on the menu she was sold.",
      "Feed her or don't, but she's going to keep making that noise.",
    ],
    diagStallCharge: [
      "The floor down there does not crack on enthusiasm alone.",
      "Gears and no bang. That's a firework with the wick left in the box.",
      "Rig's ready to knock and we brought no knuckles.",
      "Planet's noticed we're out, kid, and it is being smug about it.",
    ],
  };

  // ============ M-ONBOARD Part 2: the induction script =====================
  // Law 3 says GRIT never explains. It is suspended here BY THE FICTION rather
  // than in spite of it: he has been handed the Company induction script and is
  // contractually obliged to read it out, and he cannot get through a line
  // without riffing on it. He hates this. That tension is the whole joke
  // engine — the flat corporate line, then GRIT on the flat corporate line —
  // and it is why these do not sound like the pools above: everywhere else he
  // is editorialising on a thing that happened, and here he is being MADE to
  // teach, out loud, from somebody else's paper.
  //
  // These lines are NOT in POOLS, and that is deliberate. Everything in POOLS
  // is measured against the foreman bar's 2 x 41 and the 70-column ceiling; the
  // induction is delivered in a 40-cell box on the map with three rows of 36,
  // so it is measured against THAT (test/barks_test.js's onboard-tutor block).
  // A pool line and an induction line are different shapes of writing because
  // they are drawn in different places.
  //
  // THE ACTION IS NEVER IN THE JOKE. Every beat draws its key as an inverse
  // keycap and highlights its target tile at the same moment (see js/tutorial.js
  // ACTIONS), so these can be as stupid as they like — the player never has to
  // parse a gag to find out what to press. That is not a limit on the humour,
  // it is the thing that buys the humour its freedom (SPEC3 M-ONBOARD).
  const TUTOR = {
    // Beat 1 — put the extractor's teeth on the vein. The register is the whole
    // range on purpose (director, verbatim): dad jokes, the joke a nine-year-old
    // makes about a drill going into a hole, filthy adult ones, and puns he is
    // visibly proud of. He is funny AND a bit embarrassing, which is what twenty
    // years down a hole with nobody to talk to does to a man.
    place: [
      "Step one. 'Place the extractor upon the ore.' Upon it. Not near it. Somebody tried near.",
      "'Site the drill-head atop the deposit.' Atop. Big word from a firm that spells my name wrong.",
      "'Position the unit over the mineral body.' Over the body. Whoever wrote that has buried a man.",
      "'Ensure firm, sustained contact with the seam.' I did not write that. I have read it eleven times.",
      "'Do not site the unit on bare ground.' Somebody did. His face is in the safety pamphlet now.",
      "'The extractor requires a vein.' Requires! Like she's fussy. She's a mouth on legs. Feed her.",
      "'Establish the primary extraction point.' That is corporate for start chewing. So: chew, kid.",
      "What do you call a bit that won't bite? Un-bit-lievable. ...The shiny rock, kid. Any day now.",
      "Big drill goes in the hole. That is the induction. I hold a certificate in this, you know.",
      "Rule one of holes: the pointy end goes in the soft bit. Twenty years, and that is the manual.",
      "The teeth want that seam and the seam has been waiting four billion years. Do not be shy.",
      "The induction calls this mineral acquisition. Down here we call it biting a rock. Bite it.",
      "I asked for a poem about honest labour. They sent two sentences and a diagram. Here we are.",
    ],
    // Beat 2 — R, and where the ore actually comes out. The fault that beat the
    // director lives on this beat, so the box is at its filthiest about the one
    // thing he most needs to look at.
    rotate: [
      "'Orient the discharge aperture.' The arse end, kid. R spins the arse end. I am quoting.",
      "'Rotate PRIOR to placement.' Prior, underlined twice. Somebody learned that with their thumb.",
      "'Verify egress alignment.' Egress. My gran called it the business end and she was never wrong.",
      "'Confirm the vector of egress.' Vector! It is an ARROW. Spin it until it faces open floor.",
      "'Ensure the discharge is unobstructed.' I am going to stay professional here. ...I cannot.",
      "'Misaligned discharge is a leading cause of incident.' Incident. There's a word doing labour.",
      "'The output side shall face a receiving conveyor.' Face. As though the machine were shy.",
      "Why did the extractor lose its job? Terrible output. ...R. Press R. I'll see myself down.",
      "Pointy bit goes in, gravel comes out the back. My nephew had this one inside of a second.",
      "Section four: the yield must have somewhere to go. Thirty pages to say point it outward.",
      "R swings the little arrow. The little arrow is where rock comes out. That is the entire beat.",
      "The Company printed an appendix on which way is out. Appendix B. I have read it. Twice.",
      "R, R, R until that arrow likes what it sees. Even I manage this one, and I am mostly lung.",
    ],
    // Beat 3 — the belt, from the arrow to the rig.
    belt: [
      "'Convey the yield to the rig.' Convey. Belt it across, kid — rollers walk so that we do not.",
      "'Belts shall not terminate upon soil.' Soil has never once eaten ore. Voss proved it for us.",
      "'The conveyance MAY corner.' It may! It is allowed! Turn a corner, with Company permission!",
      "'Ensure continuity of the conveyance.' No gaps. A rock cannot jump. I asked. It cannot jump.",
      "'A conveyance is inserted at the intake.' Twenty years, and that page still gets a whistle.",
      "'Do not obstruct the belt path.' Obstruct. Stand on a moving one once and you'll learn it.",
      "'Terminate at the receiving hopper.' She swallows whatever you send. Never been proud, her.",
      "What did the belt say to the rig? I'll carry you. ...Right. I'll carry myself out. Lay it.",
      "A moving floor, for gravel. Gravel gets a moving floor. I get a bad knee and forty stairs.",
      "Section nine: a conveyance shall terminate at an intake. End it AT the rig. Into her. Yes.",
      "Run the line from that arrow to the drill. Straight, bent, whatever. Rollers do not judge.",
      "Belt her teeth to the rig and the ore walks itself. Best coworker I had. Never talked back.",
      "Drag the line home. Every belt is one fewer thing I carry with this ruin of a spine, kid.",
    ],
    // Beat 4 — the ore lands. He stops being about the map here and starts
    // pointing right: STOCK is ticking up and CHAIN is lighting, and knowing
    // where to look is worth more than another sentence out of him.
    ore: [
      "'Observe the intake register.' Watch the numbers move. That is the job, in one glowing row.",
      "'Material receipt confirms operational continuity.' It WORKS. That is what that sentence is.",
      "'The CHAIN indicator names the limiting stage.' Whatever's slowest lights. Believe the light.",
      "'Verify throughput at the panel.' Look right, kid. Those panels never lie. I sometimes do.",
      "'Induction complete.' Signed, dated, and let the record show I read every word under duress.",
      "STOCK, over on the right: iron ore, and an arrow climbing. Climbing is good. Always good.",
      "Numbers live on the right. Watch them and you'll never wonder why the drill went quiet.",
      "Why is the rig never peckish? Always got a bit between her teeth. ...Suit yourself, kid.",
      "It ate a rock. On purpose. For money. Best job in the world, and I do mean that. Mostly.",
      "She takes the whole load and never once complains. Only thing on this rig that doesn't.",
      "There she goes. Ore in the rig. First delivery. I need a moment alone. Shut up.",
      "First rock through the door. Somewhere an auditor just felt a small unfamiliar warmth.",
      "Rock landed. Nobody applauded. That's mining. Do it four hundred more times, then go deeper.",
    ],
    // He is contractually required to restate. He restates with feeling.
    nudge: [
      "Script says restate the instruction. So: the same thing, louder, with more of my character.",
      "Still with me? Good. They pay me by the shift and not by the sentence. Take all day, kid.",
      "I am required to confirm you are conscious. Blink at the screen. Lovely. Signed. Now dig.",
      "'If the operative hesitates, restate.' Restated. Also the rock will not place itself, love.",
      "Twenty years and the pause is always exactly this long. Whenever you are ready, then.",
      "The induction has a section on encouragement. One line, and it is threatening. Skipping it.",
    ],
    // The paperwork is discharged and he can go back to being himself.
    outro: [
      "Induction discharged. I read their script, you dug a hole, and they can bill us both.",
      "Paperwork's done. From here it is only rock, and rock I can actually talk about properly.",
      "Signed off. You know the four things. Everything below is those four again, but meaner.",
      "Right — script in the bin. Back to being useless at you in my own words. Much better.",
      "'Training complete', says the form. It does not say good luck. I checked. So: good luck.",
    ],
    // ...or the player put their hand up in the first ten seconds. He approves.
    skip: [
      "Skipped it. GOOD. I'd have skipped me as well. Manual's on H when pride stops working.",
      "Straight past the induction. My kind of operative. Do not tell head office I said so.",
      "Binned the script. I have wanted that script binned since the day they laminated it.",
      "No induction? Bold. This rock grades on a curve, and the curve is mostly funerals.",
    ],
  };

  // Which line, for this run, on this beat. Picked by a pure FNV-1a hash of
  // (seed, beat, restatement) and NEVER from run.rng — law 7, and it bites here
  // exactly as hard as it did for the diagnostics: the tutorial runs on a LIVE
  // run whose map, schematic offers and quake schedule all come off that
  // stream, so a line drawn because the player was slow on beat two would move
  // the whole game out from under them. Locked by an rng snapshot in
  // test/barks_test.js and again across the driven tutorial in integration.js.
  function tutorPick(seed, beat, salt, n) {
    let h = 0x811c9dc5;
    const s = String(seed >>> 0) + '|tut|' + beat + '|' + (salt | 0);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 1) % n;
  }

  // `salt` walks the pool without repeating: beat two's third restatement is a
  // different line from its first, and both are the same on every machine that
  // ever plays this seed.
  function tutorLine(run, beat, salt) {
    const pool = TUTOR[beat];
    if (!Array.isArray(pool) || !pool.length) return null;
    const seed = (run && run.seed) || 0;
    const i = (tutorPick(seed, beat, 0, pool.length) + (salt | 0)) % pool.length;
    return pool[i];
  }

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

  // ---------------- M-EVENTS: the foreman answers the fork ----------------
  // Keyed '<vignette id>:<choice index>'. GRIT is not the narrator of these
  // — the rock narrates, flatly, and he talks over the top of it about a
  // second later, which is the whole joke of having him. Every one of the
  // forty choices gets a line: the ones where he approves are as much of the
  // character as the ones where he is appalled, and a generic shrug on the
  // half of them he happened to have no opinion about would read as the
  // system not noticing what you did.
  const VIGNETTE_LINES = {
    'vault:0': "Thirty plates and a ceiling with opinions. I'll allow it.",
    'vault:1': "Good. Anything the Company welds shut, I want staying shut.",
    'crack:0': "...Kid. Kid. Tell me you heard a NOTE as well. Right. Onward.",
    'crack:1': "Plated over. I sleep better, and I don't even sleep. Dig.",
    'drone:0': "Ten plates to a flying clipboard. That IS the industry, kid.",
    'drone:1': "HA! Get IN. Eight plates, and the little snitch is a shelf.",
    'pool:0': "No comment.",
    'pool:1': "Straight down the intake. She's earned herself a warm drink.",
    'ghost:0': "He kept his half of that bargain. Don't turn round. Walk.",
    'ghost:1': "Correct. You do not haggle with a lamp. First rule of lamps.",
    'crate:0': "...That is a CAT. Right. She's crew now. Somebody feed her.",
    'crate:1': "Fine. Good timber. Something's still moving in that seam.",
    'rations:0': "Company beef, vintage unknown. Crew's chewing. Crew's happy.",
    'rations:1': "Twenty plates of banding and one very quiet lunch break.",
    'ladder:0': "Never trusted a ladder that goes the wrong way. Nice map.",
    'ladder:1': "Down it comes. One fewer road in is one fewer road in.",
    'door:0': "A DESK. Down here. Voss, you magnificent bureaucratic idiot.",
    'door:1': "You knocked. On a door. In the rock. And I love you for it.",
    'tally:0': "Ninety-seven of whatever. He stopped mid-group. Think about it.",
    'tally:1': "You finished his five. That's the kindest thing I've seen down here.",
    'seam:0': "Cut it off mid-note. The rock heard that, and so did I.",
    'seam:1': "Leave it be. Whole floor's calmer with it humming. So am I.",
    'terminal:0': "Filed a claim with a dead department. Very you. Very us.",
    'terminal:1': "Wiped and stripped. Twenty-two plates and one more paragraph.",
    'sump:0': "Twenty-five plates and a cough you'll be keeping. Fair trade.",
    'sump:1': "Sent it downstairs. Somebody down there's got wet boots now.",
    'watchman:0': "Rig Nine's lamp. She lit our way twice, that one. Twice.",
    'watchman:1': "Let her burn. Take the words. That's the whole eulogy, kid.",
    'coin:0': "Keep it. Everybody down here carries something useless. Me too.",
    'coin:1': "You paid the rock. Mock it all you like: the rock stayed paid.",
    'crossing:0': "Traded steel with strangers in a hole. Classic Tuesday.",
    'crossing:1': "Bricked it. Whoever they are, they're their own problem.",
    'suit:0': "Sample plate in a briefcase. He died doing paperwork, kid.",
    'suit:1': "Straightened his tie. You're a better man than the Company is.",
    'shrine:0': "Two gears to a pile of rocks. And the floor went quiet. Huh.",
    'shrine:1': "You took the OFFERING. Whatever's owed that, it's your tab.",
    'wind:0': "Warm draught from below is a road. Follow the road. Fast.",
    'wind:1': "Sealed it. Rig stopped flinching. So did the rest of us.",
    'offer:0': "Something came out of the rig just then. Don't ask me what.",
    'offer:1': "You said no. To THAT. Kid, I'm putting you up for foreman.",
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
    // M-SCHEMS2
    s_boiler: "Magma boiler. The planet pays the fuel bill now. Don't thank it.",
    s_echo: "Echo charges. Every fifth one's on the house. Whose house? Shh.",
    s_chute: "Gravity chute. Tear it down and most of it walks home. Tidy.",
    // M-TIER2
    s_conduit: "Deep conduits. Twice the reach under the floor. Mind the pipes.",
    s_yoke: "Trident yokes. One line in, three out. Greedy little fork.",
    s_gate: "Sorting gates. Now the junk goes right instead of nowhere.",
    s_grind: "Rock grinders. We eat the walls now. The walls started it.",
  };

  // M-MANTLE: one bespoke line per mutator. The floor's rule is already on the
  // banner in the system's flat voice — GRIT's job here is the reaction, not
  // the rule (§0 law 3), so not one of these explains a mechanic. 'worms' is
  // written and waiting: the day M-WORMS loads, the mutator deals itself and
  // this line is already here.
  const MUTATOR_LINES = {
    dark: "Lights are losing. Stay in the lamp, kid. I mean it this time.",
    hungry: "She's biting double and twice as often. Feed her or she eats us.",
    coldseam: "No coal in this rock. Smelt at the lava like our grandads did.",
    worms: "Three of 'em in the walls. Don't name them. You'll get attached.",
    glass: "Floor's glass under the rubble. Whole place is one bad step.",
    echo: "...Did you hear that? No? Good. Forget I said anything. Dig.",
    seal: "Thin floor, angry planet. Punch through fast or don't punch at all.",
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
  // M-EVENTS: what the gameover screen says once the rig is gone and the cat
  // is sitting on the rubble edge watching. It is one fixed line rather than a
  // pool on purpose — it is the ending of a running joke, and a punchline that
  // rotates is a punchline nobody can quote back at you.
  const CAT_EPITAPH = 'The cat made it out. Cats always do. Take notes, kid.';

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
        echoPend: null,      // M-MANTLE/'echo chamber': { line, at }
      };
    }
    return run._barks;
  }

  function bespokeFor(run, trigger, ctx) {
    if (trigger === 'stratumArrive')
      return run.depth <= D.STRATA_COUNT ? STRATUM_LINES[run.depth] : STRATUM_LINES.mantle;
    if (trigger === 'mantleArrive') return STRATUM_LINES.mantle;
    if (trigger === 'schematicPick' && typeof ctx === 'string') return SCHEM_LINES[ctx] || null;
    // M-MANTLE: ctx is the mutator id off the sim's arrival event.
    if (trigger === 'mutator' && typeof ctx === 'string') return MUTATOR_LINES[ctx] || null;
    if (trigger === 'foundryBuy' && typeof ctx === 'string') return META_LINES[ctx] || null;
    // M-WONDERS: ctx is the landmark id; the generic pool covers the rest.
    if ((trigger === 'landmarkFound' || trigger === 'landmarkUse') &&
        typeof ctx === 'string') {
      const L = LANDMARK_LINES[ctx];
      return (L && L[trigger === 'landmarkFound' ? 'find' : 'use']) || null;
    }
    // M-EVENTS: ctx is '<vignette id>:<choice index>'.
    if (trigger === 'vignette' && typeof ctx === 'string')
      return VIGNETTE_LINES[ctx] || null;
    return null;
  }

  // ---------------- M-MANTLE: 'echo chamber' ----------------
  // The floor repeats the foreman back at him, wrong. Every GRIT line gets one
  // answer in the Core's gold, built out of the tail of what he just said.
  //
  // IT IS A PURE FUNCTION OF THE LINE, and that is the whole trick: no pool to
  // write, no rng to spend, and — the part that matters — no draw from
  // run.rng at all. Barks fire off things the player did, and §0 law 7 says
  // what the player does must not move the stream; a mutator that rolled a
  // corruption per bark would make the quake schedule depend on how often
  // somebody jammed a belt. The shape is chosen by an FNV-1a hash of the line,
  // so the same sentence always comes back the same way and a player can
  // notice that it does.
  //
  // Three shapes, all of them the rock being bad at language rather than the
  // rock being clever: the tail stuttering, the tail backwards, and the last
  // word shouted. Two words, never three, so no echo can outgrow the bar.
  function echoOf(line) {
    const words = String(line || '').replace(/[^A-Za-z' ]+/g, ' ').trim()
      .split(/\s+/).filter(function (w) { return w.length > 1; });
    if (!words.length) return null;
    const tail = words.slice(-2).map(function (w) { return w.toLowerCase(); });
    const last = tail[tail.length - 1];
    let h = 0x811c9dc5;
    const src = String(line);
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const shape = (h >>> 1) % 3;
    let s;
    if (shape === 0) s = tail.join(' ') + '. ' + last + '. ' + last + '.';
    else if (shape === 1) s = last + '. ' + tail.slice().reverse().join(' ') + '.';
    else s = tail.join(' ') + '... ' + last.toUpperCase() + '.';
    s = '...' + s;
    // A pathological line (two very long words) falls back to the short form
    // rather than being cut mid-word — the bar never shows half a sentence.
    if (s.length > 70) s = '...' + last + '. ' + last + '.';
    return s.length > 70 ? null : s;
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
    // M-WIDE: the newest line used to be on screen TWICE — typing in the
    // foreman bar and mirrored into the LOG at the same moment — which spent
    // two panels saying one sentence. The mirror is now DEFERRED: a line goes
    // into the LOG when it stops being the current line, either because
    // another one supersedes it (here) or because its hold ran out (tick).
    // The typewriter keeps the moment; the LOG keeps the history.
    flushMirror(run, S);
    run.foreman = { text: line, t0: run.totalT, until: run.totalT + dur,
                    voice: core ? 'core' : 'grit' };
    S.mirror = {
      text: (core ? '  ▸ ' : 'GRIT ▸ ') + line,
      color: core ? D.COLORS.gold : D.COLORS.darkgray, t: run.t,
    };
    // M-MANTLE/'echo chamber': the floor answers him, about a beat after he
    // finishes typing (GRIT reveals 2 chars a tick). Scheduled rather than
    // said, because an echo that landed on the same tick would simply replace
    // the line it is echoing and nobody would ever read the original. An echo
    // is Core-voiced and therefore never echoes itself, and a Core intrusion
    // already pending outranks it — the planet does not interrupt itself.
    if (!core && run.mutator === 'echo' && !S.corePend) {
      const e = echoOf(line);
      if (e) S.echoPend = { line: e, at: run.totalT + Math.ceil(line.length / 2) + 2 * HZ };
    }
    return line;
  }
  // Hand the last spoken line to the LOG (SPEC2 §F's mirror, one beat later).
  function flushMirror(run, S) {
    if (!S.mirror) return;
    const m = S.mirror;
    S.mirror = null;
    if (!run.messages) return;
    run.messages.push(m);
    if (run.messages.length > 40) run.messages.shift();
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

  // ---------------- M-ONBOARD API ----------------
  // engine.js drains sim.js's 'diagnostic' event and lands here, once per cause
  // per run. The mapping is deliberately partial: a cause with no entry is one
  // GRIT already covers through an ambient pool, and he says nothing twice.
  const DIAG_POOL = {
    beltJam: 'diagBeltJam', starved: 'diagStarved',
    stallGear: 'diagStallGear', stallCharge: 'diagStallCharge',
  };

  // Picked by a pure FNV-1a hash of (seed, cause) rather than from run.rng —
  // the reasoning that moved Barks.review off the stream in M-RECAP, and it
  // bites harder here. These lines fire ONLY when the player has made a
  // mistake, so a draw would make the quake schedule depend on whether
  // somebody laid a belt wrong. Law 7 is explicit: what the player does must
  // not move the stream. Locked by a run.rng snapshot in test/barks_test.js.
  function diagPick(run, cause, n) {
    let h = 0x811c9dc5;
    const s = String((run && run.seed) >>> 0) + '|diag|' + cause;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 1) % n;
  }

  // Returns the line, or null when the cause is one of GRIT's ambients, when
  // there is no pool, or when the cooldown says he is still talking. Every one
  // of those is a safe silence: the player has already been told what is wrong.
  function diagSay(run, cause) {
    if (!run) return null;
    const pool = POOLS[DIAG_POOL[cause]];
    if (!Array.isArray(pool) || !pool.length) return null;
    const S = stateOf(run);
    if (run.totalT - S.lastAt < COOLDOWN) return null;
    return say(run, S, pool[diagPick(run, cause, pool.length)]);
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
    // foreman expiry: hold until `until`, render fades 2s, then clear. The
    // deferred LOG mirror lands when the hold ends — from that moment the bar
    // is only fading it, and the line belongs to history (M-WIDE).
    if (!run.foreman || run.totalT > run.foreman.until) flushMirror(run, S);
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

    // M-MANTLE/'echo chamber': ...and on those floors, everything he says
    // comes back. In the Core's voice, in the Core's gold, and wrong.
    if (S.echoPend && run.totalT >= S.echoPend.at) {
      const e = S.echoPend;
      S.echoPend = null;
      say(run, S, e.line, 'core');
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
    // M-ONBOARD: GRIT's editorial on a fault the sim already explained
    diag: diagSay, DIAG_POOL: DIAG_POOL,
    // M-ONBOARD Part 2: the induction script (js/tutorial.js reads these)
    TUTOR: TUTOR, tutor: tutorLine,
    // M-RECAP
    review: review, reviewTier: reviewTier, reviewCtx: reviewCtx,
    fillReview: fillReview, REVIEWS: REVIEWS,
    // data exposed for the headless acceptance test (SPEC2 §G)
    POOLS: POOLS, STRATUM_LINES: STRATUM_LINES, SCHEM_LINES: SCHEM_LINES,
    MUTATOR_LINES: MUTATOR_LINES,     // M-MANTLE
    echoOf: echoOf,                   // M-MANTLE/'echo chamber' (pure, rng-free)
    META_LINES: META_LINES, EPITAPHS: EPITAPHS, TOASTS: TOASTS,
    LANDMARK_LINES: LANDMARK_LINES,   // M-WONDERS
    VIGNETTE_LINES: VIGNETTE_LINES,   // M-EVENTS
    CAT_EPITAPH: CAT_EPITAPH,         // M-EVENTS
    TRIGGERS: TRIGGERS, COOLDOWN: COOLDOWN, PRIORITY: PRIORITY,
  };
})();
