import { useState } from "react";
import { Medal, Trophy, Crosshair, Skull, Coins, Gem, TrendingUp, User, Pencil, Check, X, Gift } from "lucide-react";
import { type PlayerProfile, kdRatio, levelFromProfile, winRate } from "./playerProfile";
import { BOOYAH_REWARDS, claimableTiers, rewardForTier } from "./booyahPass";

type Props = {
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
  onClose?: () => void;
};

export default function ProfileCard({ profile, onChange, onClose }: Props) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);

  const level = levelFromProfile(profile);
  const kd = kdRatio(profile);
  const win = winRate(profile);
  const claimable = claimableTiers(profile.booyahPassTier, profile.booyahPassClaimed);

  const saveName = () => {
    const trimmed = draftName.trim().slice(0, 16);
    if (trimmed) {
      onChange({ ...profile, name: trimmed });
    } else {
      setDraftName(profile.name);
    }
    setEditing(false);
  };

  const cancelName = () => {
    setDraftName(profile.name);
    setEditing(false);
  };

  const claimTier = (tier: number) => {
    const r = rewardForTier(tier);
    if (!r) return;
    onChange({
      ...profile,
      gold: profile.gold + r.gold,
      diamonds: profile.diamonds + r.diamonds,
      booyahPassClaimed: Array.from(new Set([...profile.booyahPassClaimed, tier]).values()).sort((a, b) => a - b),
    });
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-[55] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-5 shadow-[var(--shadow-hud)]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.35em] text-foreground">Operator Profile</h2>
          {onClose && (
            <button aria-label="Close profile" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* header card */}
        <div className="mt-4 rounded-2xl border border-[var(--hud-accent)]/30 bg-[var(--hud-panel)]/60 p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--hud-accent)]/20 text-[var(--hud-accent)]">
              <User className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value.slice(0, 16))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName();
                        if (e.key === "Escape") cancelName();
                      }}
                      autoFocus
                      className="w-40 rounded-md border border-[var(--hud-accent)]/50 bg-background px-2 py-1 text-sm font-bold uppercase tracking-wide text-foreground outline-none"
                    />
                    <button onClick={saveName} className="text-[var(--hud-accent)] hover:text-foreground">
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-lg font-black uppercase tracking-wide text-foreground">{profile.name}</p>
                    <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-[var(--hud-accent)]">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              <p className="mt-0.5 text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
                Guest ID · {profile.id.slice(0, 8)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-full bg-[var(--hud-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)]">
                  Lv. {level}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{win}% win rate</span>
              </div>
            </div>
          </div>
        </div>

        {/* currencies */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/60 px-4 py-3">
            <Coins className="h-5 w-5 text-[#ffd45e]" />
            <div>
              <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">Gold</p>
              <p className="text-base font-bold tabular-nums text-foreground">{profile.gold.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/60 px-4 py-3">
            <Gem className="h-5 w-5 text-[#7dd3fc]" />
            <div>
              <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">Diamonds</p>
              <p className="text-base font-bold tabular-nums text-foreground">{profile.diamonds.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat icon={Crosshair} label="Kills" value={profile.totalKills.toLocaleString()} />
          <Stat icon={Skull} label="Deaths" value={profile.totalDeaths.toLocaleString()} />
          <Stat icon={TrendingUp} label="K/D Ratio" value={kd.toFixed(2)} />
          <Stat icon={Trophy} label="Matches Won" value={profile.matchesWon.toLocaleString()} />
        </div>

        {/* Booyah Pass */}
        <div className="mt-3 rounded-xl border border-border/50 bg-card/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Medal className="h-4 w-4 text-[var(--hud-accent)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">Booyah Pass</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--hud-accent)]">
              Tier {profile.booyahPassTier}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--hud-accent)]"
              style={{ width: `${profile.booyahPassXp / 10}%` }}
            />
          </div>
          <p className="mt-1.5 text-[9px] uppercase tracking-widest text-muted-foreground">
            {1000 - profile.booyahPassXp} XP to next tier
          </p>

          {claimable.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--hud-accent)]">Claimable rewards</p>
              {claimable.map((tier) => {
                const r = rewardForTier(tier)!;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => claimTier(tier)}
                    className="flex w-full items-center justify-between rounded-xl border border-[var(--hud-accent)]/30 bg-[var(--hud-accent)]/10 px-3 py-2 transition active:scale-95"
                  >
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-[var(--hud-accent)]" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">Tier {tier} — {r.label}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--hud-accent)]">Claim</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
          Play matches to earn gold, diamonds, and unlock characters.
        </p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Crosshair; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/60 px-4 py-3">
      <Icon className="h-4 w-4 text-[var(--hud-accent)]" />
      <div>
        <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
        <p className="text-sm font-bold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}
