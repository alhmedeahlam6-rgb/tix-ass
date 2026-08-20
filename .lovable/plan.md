# IRONHOWL — MASTER PLAN

## AI WORKING RULES (READ FIRST, EVERY TIME)

1. If the user sends EXACTLY this message: `I've successfully remixed this project. What would be a good next step?`
   → DO NOT ask questions. DO NOT propose next steps. Read this plan + `PROGRESS.md`, then immediately ship as much of the unfinished list as possible. Do not hold back.
2. Before any work: read this file and `PROGRESS.md`.
3. After any work: come back to this file.
   - If the thing done is in the list below → put `X ` in front of that line.
   - If it is NOT in the list → add a new line under `## OFF-LIST WORK` in this format:
     `- X <what was done> — files: <file paths> — lines: <edited X lines 20-80> — <one line summary>`
4. Never delete completed lines; the `X` marks are the progress record.
5. Use Lovable Cloud directly when needed and no user approval is required; if approval is required, skip it and note it.
6. when you done  the list you picked come back here update what you did and then pick nother 3 or 4  featers and do them , when you done them come back here and take nother 3/4 ..etc you should keep going untill one of the 2 happens the platform stop you by force or the user asked to stop you aree aloowed to run up to 2h without stopping
7. every thing you dont needs an icon or pic you should and have to create the pic using your imagine tool

## OFF-LIST WORK

- X Polished deploy/boot UX — percentage readout, extra mobile tips, clearer CTA — files: `src/components/arena/GameShell.tsx`
- X Manual "Start match" overlay after map load with back-to-lobby option — files: `src/components/arena/LoneWolfArena.tsx`
- X Deferred leaderboard fetch until first interaction or 2.5s idle — files: `src/components/arena/LoneWolfArena.tsx`
- X Richer match summary card with K/D, rounds and prominent Play Again CTA — files: `src/components/arena/LoneWolfArena.tsx`
- X Larger touch fire/move zones and fire-button press feedback — files: `src/components/arena/TouchControls.tsx`
- X Bot AI depth: difficulty tiers, tactical state machine, collision-aware movement, firing discipline — files: `src/components/arena/botAi.ts`, `src/components/arena/LoneWolfArena.tsx`, `src/components/arena/settings.ts`, `src/components/arena/SettingsPanel.tsx`
- X Headshot tracking in match summary HUD and reward logic — files: `src/components/arena/LoneWolfArena.tsx`
- X Character Link system: match-based unlocks, locked indicators in picker, progress tracked in profile — files: `src/components/arena/characters.ts`, `src/components/arena/playerProfile.ts`, `src/components/arena/CharacterPicker.tsx`, `src/components/arena/GameShell.tsx`, `src/components/arena/LoneWolfArena.tsx`
- X Booyah Pass rewards: claimable tiers for gold/diamonds, stored in profile — files: `src/components/arena/booyahPass.ts`, `src/components/arena/playerProfile.ts`, `src/components/arena/ProfileCard.tsx`
- X Armory weapon skin stat effects in the arena: skin stat deltas are applied to the player's current weapon in LoneWolfArena shoot — files: `src/components/arena/weaponSkins.ts`, `src/components/arena/LoneWolfArena.tsx`, `src/components/arena/GameShell.tsx`
- X Store expansion: Crates tab that adds weapon skins to vault/armory, Currency tab for mock diamond packs, and Diamonds shown in lobby/profile — files: `src/components/arena/StorePanel.tsx`, `src/components/arena/GameShell.tsx`, `src/components/arena/weaponSkins.ts`

---

## Phase 1: Authentication & Lobby
- X Guest Login: Play without linking an account.
- Social Login: Link progress to Facebook, Google, VK, or Twitter.
- Loading Screen Tips: Random gameplay hints displayed while assets load.
- Lobby Dashboard: The main 3D hub where your character stands.
- X Profile Card: Shows your ID, level, likes, past rank, and battle stats (K/D, headshot rate).
- X Currency System (Gold): Free currency earned by playing, used for basic items/upgrades.
- X Currency System (Diamonds): Premium currency bought with real money.
- X Store: The main shop for characters, skins, and crates.
- X Luck Royale: A gacha system with different spinning wheels (Diamond, Gold, Weapon, Incubator) to gamble for rare skins.
- X Booyah Pass (formerly Elite Pass): A tiered battle pass that gives rewards as you gain XP.
- X Character System: Roster of unique characters, each with a specific active or passive ability.
- X Character Link System: Unlocking characters for free by playing matches with them.
- X Skill Slots: Combining one active ability and three passive abilities into a custom loadout.
- X Pet System: Companions that follow you and provide an extra passive skill.
- X Vault: Your inventory for clothing, weapon skins, and emotes.
- X Armory: Where you equip weapon skins that actually change weapon stats (e.g., + damage, - reload speed).
- Guild System: Clans you can join to play together, earn guild tokens, and enter guild wars.
- Friends List: System to add, invite, inspect, or spectate friends.
- World/Guild/Team Chat: Text chat interface in the lobby.
- Team Voice Chat: In-lobby microphone and speaker toggles.

## Phase 2: Pre-Match & Loadout
- Mode Selection: Choosing between BR, CS (Clash Squad), Lone Wolf, or Custom Rooms.
- Ranked vs. Casual: Toggle for playing for rank points or just for fun.
- Map Download Center: A UI to manually download specific maps to save phone storage.
- Loadout - Scanner: Reveals players in the plane and nearby when parachuting.
- Loadout - Bonfire: Placed on the ground in-game to heal HP and EP over time.
- Loadout - Airdrop: Calls in a personal loot crate during the match.
- X Loadout - Bounty Token: Gives extra loot when you get your first kill.
- X Loadout - Armor Crate: Start the match with a random level helmet/vest.
- Loadout - Leg Pockets: Increases starting backpack capacity.
- Spawn Island: The 60-second waiting lobby where players run around before the plane.
- Spawn Island Interactions: Throwing snowballs/fireworks at other players.

## Phase 3: The Drop
- Flight Path: The straight line the plane takes across the map.
- Eject Button: The prompt to jump out of the plane.
- Surfboard Phase: Freefalling with a directional joystick to control distance.
- Parachute Phase: Parachute opens automatically (or manually), slowing descent for precise landing.
- Falcon Pet Boost: A pet skill that speeds up your dive and parachute speed.

## Phase 4: HUD, Movement & Controls
- Virtual Joystick: Left thumb stick for walking/running directions.
- Sprint Button: Locks you into a continuous fast run without holding the joystick.
- Freelook (The "Eye"): Draggable eye icon to rotate the camera 360 degrees without changing run direction.
- Crouch Button: Lowers profile, reduces footstep noise, improves accuracy.
- Prone Button: Laying completely flat in the grass.
- Jump Button: Vaulting over low walls or jumping during combat.
- Right Fire Button: Main shooting button that you can also drag to control recoil/aim.
- Left Fire Button: A secondary static shoot button, mostly used when scoped in.
- ADS (Aim Down Sights): Button to open your weapon's scope.
- Quick Weapon Switch: Instantly swap between primary and secondary weapons.
- Quick Reload Button: Dedicated icon to reload the equipped gun.
- Smart Grenade Slot: Tapping throws immediately, holding shows a trajectory arc.
- Gloo Wall Slot: Dedicated button to instantly place a Gloo Wall.
- Medkit Slot: Tap to heal; holding shows a wheel of different healing items.
- Active Skill Button: Triggers your character's main power.
- X Ping/Marker System: Double tap to mark enemies, single tap to mark loot or locations.
- Minimap: Top left map showing safe zones, your team, and red dots for unsilenced shots.
- Kill Feed: Text scrolling showing who killed who and with what weapon.
- Team UI: Teammate health bars, names, knocked/dead state.
- Custom HUD Settings: Resize, move, and change transparency of every button.

## Phase 5: Looting & Inventory
- Auto-Pickup: Automatically sucks loot into your inventory by walking over it.
- Auto-Pickup Priority: Settings for Medkits, Ammo, or Attachments first.
- Backpack System: Level 1, 2, and 3 bags that increase carry capacity.
- X Armor System (Vests): Level 1 to 4 vests that reduce body damage.
- X Armor System (Helmets): Level 1 to 4 helmets that reduce headshot damage.
- Armor Attachments: Thickener or HP booster attachments for vests.
- Weapon Attachments - Muzzle: Increases damage range.
- Weapon Attachments - Silencer: Hides your shots from the minimap.
- Weapon Attachments - Foregrip: Reduces bullet spread and recoil.
- Weapon Attachments - Magazine: Increases bullet capacity and reload speed.
- Weapon Attachments - Stock: Increases movement speed while aiming.
- Weapon Attachments - Scopes: 2x, 4x, and Thermal scopes.
- FF Coins: Yellow tokens looted off the ground used as in-match currency.

## Phase 6: Combat & Survival Mechanics
- Aim Assist (Default): Crosshair magnetically locks onto the enemy's chest when firing.
- Precise on Scope: Aim assist on hip-fire, off when aiming down sights.
- Full Control: Aim assist completely disabled.
- Crosshair Bloom: Reticle widens the longer you hold the trigger.
- Damage Numbers: White for body, Yellow for limbs/armor, Red for headshots.
- X Melee Deflection: Pans, Bats, and Katanas on the back block bullets.
- Gloo Walls: Deployable temporary cover that absorbs damage and blocks sight.
- X Frag Grenades: Explosives with a cook timer.
- X Flashbangs: Blinds enemies (screen goes white).
- X Smoke Grenades: Creates a cloud to block vision.
- X Decoy Grenades: Fake gunshot sounds and a red dot on the enemy minimap.
- X EP (Energy Points) System: Yellow bar above HP that slowly converts to HP.
- X Mushrooms: Ground pickup, few seconds to eat, provides EP.
- X Inhalers: Used while running for instant small HP and EP.
- X Medkits: Stand still 3 seconds to heal a large chunk of HP.
- X Treatment Gun/Sniper: Heals teammates when shot, hurts enemies.

## Phase 7: Map Dynamics & Vehicles
- Vending Machines: Spend FF Coins for guns, ammo, or revive cards.
- Airdrops (Loot Drops): Crates with high-tier weapons like the AWM or Groza.
- Arsenal Doors: Locked bunkers with extreme loot, requiring a key.
- X Safe Zone (The Circle): White circle indicating where you are safe.
- X Electrical Storm (The Zone): Shrinking wall that damages you outside the safe zone.
- Red Zone: Temporary area bombarded with random explosions.
- UAV Drone (Danger Zone): Drone that reveals everyone inside its yellow circle.
- Blue Zone: Start-of-match area with much higher tier loot.
- Ziplines: Cables for fast straight-line travel across gaps.
- Launchpads: Jump pads that catapult you across the map.
- Vehicles: Cars, bikes, monster trucks, and Tuk-Tuks.
- Driving Controls: Forward/back, left/right buttons, and a horn.
- Passenger Mechanics: Shooting out of the vehicle from the passenger seat.
- Vehicle Damage: Cars blow up if shot enough, killing anyone inside.

## Phase 8: Death, Revival & Post-Match
- Knocked State: Crawl on the floor and slowly bleed out in team games.
- Help UI: Knocked players ping teammates for a revive.
- Reviving: Teammate holds a button for 3 seconds to get you back up with low HP.
- Execution/Finishing: Shooting a knocked player until they turn into a loot box.
- Spectator Mode: Watching your teammates' POV after you die.
- Revival Points: Stand in a circle to bring dead teammates back to life.
- Revival Cards: Bought at vending machines to instantly revive a dead teammate.
- Redrop Sequence: Revived players fall from the sky again with only a basic pistol.
- Like System: Spectators can give a "like" to the person they are watching.
- Booyah Screen: Victory banner if you are the last one standing.
- Match Summary: Total kills, damage dealt, survival time, and headshots.
- Rank Calculation: Points gained for survival time and kills, pushing rank up or down.
- Play Again Button: Immediately queue for the next match without returning to the lobby.
