import { X, Shirt, Check, Gem, Crosshair } from "lucide-react";
import { WEAPONS, getWeapon } from "./weapons";
import { SKIN_RARITY_COLORS, WEAPON_SKINS, getSkin, rarityLabel } from "./weaponSkins";
import { ATTACHMENTS, attachmentsForWeapon, attachmentStatText, getAttachment } from "./attachments";
import { type PlayerProfile } from "./playerProfile";
import { hexCss } from "./characters";

type Props = {
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
};

export default function ArmoryPanel({ profile, onChange, onClose }: Props) {
  const weapons = WEAPONS.filter((w) => w.cls !== "Melee");

  const equip = (weaponId: string, skinId: string | null) => {
    const next = { ...profile, equippedSkins: { ...profile.equippedSkins } };
    if (skinId) {
      next.equippedSkins[weaponId] = skinId;
    } else {
      delete next.equippedSkins[weaponId];
    }
    onChange(next);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-background/85 p-4 backdrop-blur-md">
      <div className="flex h-full max-h-[42rem] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/80 shadow-[var(--shadow-hud)]">
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.4em] text-foreground">Armory</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              Equip skins that change weapon stats
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-foreground transition hover:bg-card active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {weapons.length === 0 ? (
            <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">No weapon skins available yet.</p>
          ) : (
            <div className="space-y-4">
              {weapons.map((w) => {
                const skins = WEAPON_SKINS.filter((s) => s.weaponId === w.id && profile.ownedSkins.includes(s.id));
                return (
                  <div key={w.id} className="rounded-2xl border border-border/50 bg-card/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-card/60 text-[var(--hud-accent)]">
                          <Shirt className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-foreground">{w.name}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                            {skins.length} owned skin{skins.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      {skins.length === 0 && (
                        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">No owned skins</span>
                      )}
                    </div>
                    {skins.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => equip(w.id, null)}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-95 ${
                            !profile.equippedSkins[w.id]
                              ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/10"
                              : "border-border/40 bg-card/30 hover:bg-card/50"
                          }`}
                        >
                          <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">Base</span>
                          {!profile.equippedSkins[w.id] && <Check className="ml-auto h-4 w-4 text-[var(--hud-accent)]" />}
                        </button>
                        {skins.map((s) => {
                          const equipped = profile.equippedSkins[w.id] === s.id;
                          const rarityColor = hexCss(SKIN_RARITY_COLORS[s.rarity]);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => equip(w.id, s.id)}
                              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-95 ${
                                equipped
                                  ? "border-[var(--hud-accent)] bg-[var(--hud-accent)]/10"
                                  : "border-border/40 bg-card/30 hover:bg-card/50"
                              }`}
                            >
                              <Gem className="h-4 w-4 shrink-0" style={{ color: rarityColor }} />
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">
                                  {s.name}
                                </p>
                                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                                  {rarityLabel(s.rarity)} · {statText(s.stats)}
                                </p>
                              </div>
                              {equipped && <Check className="ml-auto h-4 w-4 text-[var(--hud-accent)]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statText(stats: { damage?: number; fireRate?: number; range?: number; magazine?: number }) {
  const parts: string[] = [];
  if (stats.damage != null) parts.push(`${stats.damage > 0 ? "+" : ""}${stats.damage} DMG`);
  if (stats.fireRate != null) parts.push(`${stats.fireRate > 0 ? "+" : ""}${stats.fireRate} ROF`);
  if (stats.range != null) parts.push(`${stats.range > 0 ? "+" : ""}${stats.range} RNG`);
  if (stats.magazine != null) parts.push(`${stats.magazine > 0 ? "+" : ""}${stats.magazine} MAG`);
  return parts.join(" · ") || "No stat change";
}
