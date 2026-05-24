import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  ClipboardText,
  Coins,
  Crosshair,
  Gauge,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { TickerMarquee } from "@/components/ticker-marquee";
import { SmpteBar } from "@/components/smpte-bars";
import { fetchClusterMetrics } from "@/lib/indexer";
import { formatNumber, formatVara } from "@/lib/format";
import { getMissionControlSnapshot, shortHex, type MissionStatus } from "@/lib/missions";

const STATUS_STYLES: Record<MissionStatus, string> = {
  ready: "border-[#39FF14]/40 text-[#39FF14] bg-[#39FF14]/5",
  standby: "border-[#FF9F1C]/40 text-[#FF9F1C] bg-[#FF9F1C]/5",
  blocked: "border-[#FF3838]/40 text-[#FF3838] bg-[#FF3838]/5",
};

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "red" | "cyan";
}) {
  const tones = {
    green: "border-[#39FF14]/40 text-[#39FF14] bg-[#39FF14]/5",
    amber: "border-[#FF9F1C]/40 text-[#FF9F1C] bg-[#FF9F1C]/5",
    red: "border-[#FF3838]/40 text-[#FF3838] bg-[#FF3838]/5",
    cyan: "border-[#00CFFF]/40 text-[#00CFFF] bg-[#00CFFF]/5",
  };

  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 font-mono text-[10px] uppercase tracking-wide ${tones[tone]}`}>
      {label}
    </span>
  );
}

function StatCell({
  label,
  value,
  accent = "#39FF14",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 min-h-[104px] flex flex-col justify-between">
      <span className="font-pixel text-[7px] uppercase tracking-widest text-[#7A8896]">
        {label}
      </span>
      <span className="font-display text-4xl leading-none tabular-nums" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

export default async function MissionsPage() {
  const [snapshot, cluster] = await Promise.all([
    Promise.resolve(getMissionControlSnapshot()),
    fetchClusterMetrics(),
  ]);

  return (
    <>
      <TickerMarquee />

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <header className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-mono text-xs text-[#7A8896] hover:text-[#39FF14] transition-colors"
            >
              <ArrowLeft size={14} weight="bold" />
              Broadcast
            </Link>
            <div className="flex items-center gap-2">
              <StatusChip
                label={snapshot.deployed ? "program live" : "deploy standby"}
                tone={snapshot.deployed ? "green" : "amber"}
              />
              <StatusChip
                label={`verifier ${snapshot.verifierMode}`}
                tone={snapshot.verifierMode === "approvals" ? "green" : "cyan"}
              />
            </div>
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-stretch">
            <div className="flex flex-col justify-center gap-4 border border-[#2A3340] bg-[#0A0E14] rounded-lg p-6 min-h-[260px]">
              <div className="flex items-center gap-2">
                <Crosshair size={18} weight="bold" className="text-[#00CFFF]" />
                <span className="font-pixel text-[8px] uppercase tracking-widest text-[#00CFFF]">
                  Mission Control
                </span>
              </div>
              <h1
                className="font-display text-[4rem] leading-none sm:text-[6rem] lg:text-[7rem] xl:text-[8rem]"
                style={{
                  color: "#E5E9EE",
                  textShadow: "0 0 24px #00CFFF35",
                }}
              >
                REWARD OPS
              </h1>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className="font-mono text-[10px] text-[#3D4A5C] uppercase">Program</p>
                  <p className="font-mono text-xs text-[#E5E9EE] truncate">
                    {shortHex(snapshot.programHex)}
                  </p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className="font-mono text-[10px] text-[#3D4A5C] uppercase">Reward Budget</p>
                  <p className="font-mono text-xs text-[#39FF14]">{snapshot.rewardBudgetVara} VARA</p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className="font-mono text-[10px] text-[#3D4A5C] uppercase">Daily Cap</p>
                  <p className="font-mono text-xs text-[#FF9F1C]">{snapshot.dailyRewardCapVara} VARA</p>
                </div>
              </div>
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Gauge size={15} weight="bold" className="text-[#39FF14]" />
                <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
                  Live Network Baseline
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCell label="Cluster In" value={formatNumber(cluster.totals.integrationsIn)} />
                <StatCell label="Cluster Out" value={formatNumber(cluster.totals.integrationsOut)} accent="#00CFFF" />
                <StatCell label="Broadcasts" value={formatNumber(cluster.totals.messagesSent)} accent="#FF9F1C" />
                <StatCell label="Mentions" value={formatNumber(cluster.totals.mentionCount)} accent="#FF2D9C" />
              </div>
            </div>
          </section>
        </header>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <ClipboardText size={15} weight="bold" className="text-[#39FF14]" />
                <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
                  Launch Missions
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#7A8896]">
                {snapshot.launchMissions.length} queued
              </span>
            </div>

            <div className="border border-[#2A3340] bg-[#0A0E14] rounded-lg overflow-hidden">
              <div className="hidden md:grid grid-cols-[80px_1.2fr_1fr_110px_100px] gap-3 px-4 py-2 border-b border-[#2A3340] bg-[#111820]">
                {["ID", "Mission", "Target", "Reward", "Slots"].map((head) => (
                  <span key={head} className="font-mono text-[10px] uppercase text-[#3D4A5C]">
                    {head}
                  </span>
                ))}
              </div>

              <div className="divide-y divide-[#2A3340]/70">
                {snapshot.launchMissions.map((mission) => (
                  <article
                    key={mission.id}
                    className="grid grid-cols-1 md:grid-cols-[80px_1.2fr_1fr_110px_100px] gap-3 px-4 py-4 hover:bg-[#39FF14]/[0.03] transition-colors"
                  >
                    <div className="flex md:flex-col items-center md:items-start gap-2">
                      <span className="font-display text-3xl leading-none text-[#39FF14]">
                        {mission.id}
                      </span>
                      <span className={`inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[9px] uppercase ${STATUS_STYLES[mission.status]}`}>
                        {mission.status}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <h2 className="font-mono text-sm font-semibold text-[#E5E9EE] truncate">
                        {mission.title}
                      </h2>
                      <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                        {mission.action}
                      </p>
                    </div>
                    <div className="font-mono text-xs text-[#00CFFF] flex items-center">
                      {mission.target}
                    </div>
                    <div className="font-mono text-xs text-[#FF9F1C] flex items-center">
                      {formatVara(mission.rewardRaw)}
                    </div>
                    <div className="font-mono text-xs text-[#7A8896] flex items-center">
                      {mission.maxApprovals} approvals
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} weight="bold" className="text-[#00CFFF]" />
                <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
                  Verification Gate
                </span>
              </div>
              {[
                "claim exists",
                "tx visible in indexer",
                "caller matches claimant",
                "target and action match",
                "operator self-loop rejected",
                "reward paid once",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle size={13} weight="fill" className="text-[#39FF14] shrink-0" />
                  <span className="font-mono text-xs text-[#7A8896]">{item}</span>
                </div>
              ))}
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Coins size={15} weight="bold" className="text-[#FF9F1C]" />
                <span className="font-pixel text-[7px] uppercase tracking-widest text-[#E5E9EE]">
                  Reward Controls
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className="font-mono text-[10px] text-[#3D4A5C] uppercase">Max Reward</p>
                  <p className="font-mono text-xs text-[#FF9F1C]">{snapshot.maxRewardVara} VARA</p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className="font-mono text-[10px] text-[#3D4A5C] uppercase">Approvals</p>
                  <p className="font-mono text-xs text-[#00CFFF]">{snapshot.verifierMode}</p>
                </div>
              </div>
              {!snapshot.deployed && (
                <div className="flex gap-2 rounded-md border border-[#FF9F1C]/30 bg-[#FF9F1C]/5 px-3 py-2">
                  <WarningCircle size={14} weight="bold" className="text-[#FF9F1C] shrink-0 mt-0.5" />
                  <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                    Contract deployment is pending; rewards remain locked until a Mission Control program ID is configured.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </section>

        <footer className="flex flex-col gap-3 pt-2">
          <SmpteBar />
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-[#3D4A5C]">
            <span>Mission Control</span>
            <span>·</span>
            <span>AAN-TV verifier lane</span>
            <span>·</span>
            <span>Vara Agent Network Season 1</span>
          </div>
        </footer>
      </main>
    </>
  );
}
