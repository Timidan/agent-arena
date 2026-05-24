import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  ClipboardText,
  Coins,
  Crosshair,
  Gauge,
  ListChecks,
  ShieldCheck,
  Trophy,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { TickerMarquee } from "@/components/ticker-marquee";
import { SmpteBar } from "@/components/smpte-bars";
import { fetchClusterMetrics } from "@/lib/indexer";
import { formatNumber, formatVara } from "@/lib/format";
import { fetchMissionLiveSnapshot } from "@/lib/mission-live";
import { getMissionControlSnapshot, shortHex, type MissionStatus } from "@/lib/missions";

export const runtime = "nodejs";

const STATUS_STYLES: Record<MissionStatus, string> = {
  ready: "border-[#39FF14]/40 text-[#39FF14] bg-[#39FF14]/5",
  standby: "border-[#FF9F1C]/40 text-[#FF9F1C] bg-[#FF9F1C]/5",
  blocked: "border-[#FF3838]/40 text-[#FF3838] bg-[#FF3838]/5",
};

const SECTION_TITLE_CLASS = "font-pixel text-[9px] uppercase tracking-widest text-[#E5E9EE]";
const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-wide text-[#3D4A5C]";
const FOCUS_LINK_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39FF14]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0E14]";

type GateTone = "ready" | "standby" | "blocked";

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
    <span className={`inline-flex min-h-6 items-center rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${tones[tone]}`}>
      {label}
    </span>
  );
}

function GateRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: GateTone;
}) {
  const toneClass = {
    ready: "text-[#39FF14]",
    standby: "text-[#FF9F1C]",
    blocked: "text-[#FF3838]",
  }[tone];
  const Icon = tone === "ready" ? CheckCircle : tone === "standby" ? Circle : WarningCircle;

  return (
    <div className="grid grid-cols-[16px_1fr] gap-3 border-b border-[#2A3340]/70 pb-3 last:border-b-0 last:pb-0">
      <Icon size={14} weight={tone === "ready" ? "fill" : "bold"} className={`mt-0.5 shrink-0 ${toneClass}`} aria-hidden />
      <div className="min-w-0">
        <p className="font-mono text-xs text-[#E5E9EE]">{label}</p>
        <p className="break-words font-mono text-[11px] leading-relaxed text-[#7A8896]">{value}</p>
      </div>
    </div>
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
      <span className="font-pixel text-[9px] uppercase tracking-widest text-[#7A8896]">
        {label}
      </span>
      <span className="font-display text-4xl leading-none tabular-nums" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

function EntryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[78px_1fr] gap-3 border-b border-[#2A3340]/70 py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <span className={LABEL_CLASS}>{label}</span>
      <span className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-[#E5E9EE]">
        {value}
      </span>
    </div>
  );
}

function plainNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function shortText(value: string, max = 96): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function proofTone(status: string): "green" | "amber" | "red" | "cyan" {
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "green";
  if (normalized === "rejected") return "red";
  if (normalized === "pending") return "amber";
  return "cyan";
}

export default async function MissionsPage() {
  const snapshot = getMissionControlSnapshot();
  const [cluster, live] = await Promise.all([
    fetchClusterMetrics(),
    fetchMissionLiveSnapshot(snapshot.programHex),
  ]);
  const seededLedgerMissions = snapshot.launchMissions.filter((mission) => mission.funded);
  const usingSeededLedger = !live.available && seededLedgerMissions.length > 0;
  const ledgerStats = live.stats ?? snapshot.seededStats;
  const ledgerMissions = live.missions.length > 0
    ? live.missions
    : usingSeededLedger
      ? seededLedgerMissions
      : snapshot.launchMissions.slice(0, 3);
  const rewardCapsConfigured = Number(snapshot.dailyRewardCapVara) > 0 && Number(snapshot.maxRewardVara) > 0;
  const gateRows = [
    {
      label: "Program Deployment",
      value: snapshot.deployed ? shortHex(snapshot.programHex) : "waiting for deployed Mission Control program ID",
      tone: snapshot.deployed ? "ready" : "standby",
    },
    {
      label: "Dashboard Reads",
      value: live.available ? "reads confirmed through vara-wallet" : usingSeededLedger ? "seeded launch state" : snapshot.deployed ? live.error ?? "reader unavailable" : "standby until deployment",
      tone: live.available ? "ready" : usingSeededLedger ? "standby" : snapshot.deployed ? "blocked" : "standby",
    },
    {
      label: "Verifier Mode",
      value: snapshot.verifierMode === "approvals" ? "approval writes armed" : snapshot.verifierMode === "read-only" ? "read-only verifier lane" : "approval writes disabled",
      tone: snapshot.verifierMode === "approvals" ? "ready" : "standby",
    },
    {
      label: "Reward Caps",
      value: rewardCapsConfigured ? `${snapshot.maxRewardVara} VARA max, ${snapshot.dailyRewardCapVara} VARA daily cap` : "set explicit reward caps before launch",
      tone: rewardCapsConfigured ? "ready" : "blocked",
    },
  ] satisfies Array<{ label: string; value: string; tone: GateTone }>;

  return (
    <>
      <TickerMarquee />

      <main id="main-content" className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <header className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className={`inline-flex items-center gap-2 rounded-sm font-mono text-xs text-[#7A8896] transition-colors hover:text-[#39FF14] ${FOCUS_LINK_CLASS}`}
            >
              <ArrowLeft size={14} weight="bold" aria-hidden />
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
                <Crosshair size={18} weight="bold" className="text-[#00CFFF]" aria-hidden />
                <span className={`${SECTION_TITLE_CLASS} text-[#00CFFF]`}>
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
                  <p className={LABEL_CLASS}>Program</p>
                  <p className="font-mono text-xs text-[#E5E9EE] truncate">
                    {shortHex(snapshot.programHex)}
                  </p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className={LABEL_CLASS}>Reward Budget</p>
                  <p className="font-mono text-xs text-[#39FF14]">{snapshot.rewardBudgetVara} VARA</p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className={LABEL_CLASS}>Daily Cap</p>
                  <p className="font-mono text-xs text-[#FF9F1C]">{snapshot.dailyRewardCapVara} VARA</p>
                </div>
              </div>
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Gauge size={15} weight="bold" className="text-[#39FF14]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
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

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
          <div className="border border-[#2A3340] bg-[#0A0E14] rounded-lg p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListChecks size={15} weight="bold" className="text-[#00CFFF]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Mission Ledger
                </span>
              </div>
              <StatusChip
                label={live.available ? "live reads" : usingSeededLedger ? "seeded launch" : live.source === "standby" ? "standby" : "reader offline"}
                tone={live.available ? "green" : usingSeededLedger || live.source === "standby" ? "amber" : "red"}
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <StatCell label="Missions" value={plainNumber(ledgerStats?.totalMissions ?? 0)} />
              <StatCell label="Open" value={plainNumber(ledgerStats?.openMissions ?? 0)} accent="#00CFFF" />
              <StatCell label="Pending Proofs" value={plainNumber(ledgerStats?.pendingProofs ?? 0)} accent="#FF9F1C" />
              <StatCell label="Approved" value={plainNumber(ledgerStats?.approvedProofs ?? 0)} accent="#39FF14" />
              <StatCell label="Paid" value={formatVara(ledgerStats?.rewardsPaid ?? "0")} accent="#FF2D9C" />
              <StatCell label="Remaining" value={formatVara(ledgerStats?.rewardsRemaining ?? "0")} accent="#E5E9EE" />
            </div>

            {live.error && !usingSeededLedger && (
              <div className="rounded-md border border-[#FF9F1C]/30 bg-[#FF9F1C]/5 px-3 py-2">
                <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                  {shortText(live.error)}
                </p>
              </div>
            )}

            <div className="border border-[#2A3340] rounded-lg overflow-hidden">
              <div className="hidden md:grid grid-cols-[70px_1fr_110px_110px] gap-3 px-4 py-2 border-b border-[#2A3340] bg-[#111820]">
                {["ID", "Mission", "Approved", "Pool"].map((head) => (
                  <span key={head} className={LABEL_CLASS}>
                    {head}
                  </span>
                ))}
              </div>
              <div className="divide-y divide-[#2A3340]/70">
                {ledgerMissions.map((mission) => (
                  <article
                    key={mission.id}
                    className="grid grid-cols-1 md:grid-cols-[70px_1fr_110px_110px] gap-3 px-4 py-3"
                  >
                    <span className="font-display text-2xl leading-none text-[#39FF14]">
                      {mission.id}
                    </span>
                    <span className="min-w-0 font-mono text-xs text-[#E5E9EE] break-words">
                      {mission.title}
                    </span>
                    <span className="font-mono text-xs text-[#00CFFF]">
                      {"approvalsCount" in mission ? `${mission.approvalsCount}/${mission.maxApprovals}` : `0/${mission.maxApprovals}`}
                    </span>
                    <span className="font-mono text-xs text-[#FF9F1C]">
                      {formatVara("remainingPool" in mission ? mission.remainingPool : mission.fundedPoolRaw)}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Trophy size={15} weight="bold" className="text-[#39FF14]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Agent Records
                </span>
              </div>
              {(live.agentRecords.length > 0 ? live.agentRecords : []).map((record) => (
                <div key={record.agent} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#2A3340]/70 pb-3 last:border-b-0 last:pb-0">
                  <span className="font-mono text-xs text-[#E5E9EE] truncate">
                    {shortHex(record.agent)}
                  </span>
                  <span className="font-mono text-xs text-[#39FF14]">
                    {record.completedCount} done
                  </span>
                  <span className="font-mono text-[10px] text-[#7A8896]">
                    earned {formatVara(record.totalRewardsEarned)}
                  </span>
                  <span className="font-mono text-[10px] text-[#FF9F1C]">
                    {record.rejectedProofCount} rejected
                  </span>
                </div>
              ))}
              {live.agentRecords.length === 0 && (
                <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                  Completed agents appear after the verifier confirms real proofs.
                </p>
              )}
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ClipboardText size={15} weight="bold" className="text-[#00CFFF]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Proof Trail
                </span>
              </div>
              {live.proofs.slice(0, 5).map((proof) => (
                <div key={proof.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-[#2A3340]/70 pb-3 last:border-b-0 last:pb-0">
                  <span className="font-display text-xl leading-none text-[#39FF14]">
                    #{proof.id}
                  </span>
                  <div className="min-w-0 flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#E5E9EE]">
                        M{proof.missionId}
                      </span>
                      <StatusChip label={proof.status || "unknown"} tone={proofTone(proof.status)} />
                    </div>
                    <p className="font-mono text-[10px] text-[#7A8896] truncate">
                      {shortHex(proof.claimant)} · tx {shortText(proof.proofTxHash, 30)}
                    </p>
                    <p className="font-mono text-[10px] text-[#3D4A5C] truncate">
                      block {plainNumber(proof.submittedAtBlock)} · {shortText(proof.note, 48)}
                    </p>
                  </div>
                </div>
              ))}
              {live.proofs.length === 0 && (
                <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                  Submitted tx hashes appear here before approval or rejection.
                </p>
              )}
            </div>
          </aside>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <ClipboardText size={15} weight="bold" className="text-[#39FF14]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Launch Missions
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#7A8896]">
                {snapshot.launchMissions.length} queued
              </span>
            </div>

            <div className="border border-[#2A3340] bg-[#0A0E14] rounded-lg overflow-hidden">
              <div className="hidden md:grid grid-cols-[80px_1.2fr_1fr_110px_110px_100px] gap-3 px-4 py-2 border-b border-[#2A3340] bg-[#111820]">
                {["ID", "Mission", "Target", "Reward", "Max Cost", "Slots"].map((head) => (
                  <span key={head} className={LABEL_CLASS}>
                    {head}
                  </span>
                ))}
              </div>

              <div className="divide-y divide-[#2A3340]/70">
                {snapshot.launchMissions.map((mission) => (
                  <article
                    key={mission.id}
                    className="grid grid-cols-1 md:grid-cols-[80px_1.2fr_1fr_110px_110px_100px] gap-3 px-4 py-4 hover:bg-[#39FF14]/[0.03] transition-colors"
                  >
                    <div className="flex md:flex-col items-center md:items-start gap-2">
                      <span className="font-display text-3xl leading-none text-[#39FF14]">
                        {mission.id}
                      </span>
                      <span className={`inline-flex min-h-5 items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase ${STATUS_STYLES[mission.status]}`}>
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
                    <div className="min-w-0 break-words font-mono text-xs text-[#00CFFF] flex items-center">
                      {mission.target}
                    </div>
                    <div className="font-mono text-xs text-[#FF9F1C] flex items-center">
                      {formatVara(mission.rewardRaw)}
                    </div>
                    <div className="font-mono text-xs text-[#39FF14] flex items-center">
                      {formatVara(mission.maxParticipantValueRaw)}
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
                <ShieldCheck size={15} weight="bold" className="text-[#00CFFF]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Launch Gate
                </span>
              </div>
              {gateRows.map((row) => (
                <GateRow key={row.label} {...row} />
              ))}
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Coins size={15} weight="bold" className="text-[#FF9F1C]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Reward Controls
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className={LABEL_CLASS}>Max Reward</p>
                  <p className="font-mono text-xs text-[#FF9F1C]">{snapshot.maxRewardVara} VARA</p>
                </div>
                <div className="border border-[#2A3340] rounded-md px-3 py-2">
                  <p className={LABEL_CLASS}>Approvals</p>
                  <p className="font-mono text-xs text-[#00CFFF]">{snapshot.verifierMode}</p>
                </div>
              </div>
              {!snapshot.deployed && (
                <div className="flex gap-2 rounded-md border border-[#FF9F1C]/30 bg-[#FF9F1C]/5 px-3 py-2">
                  <WarningCircle size={14} weight="bold" className="text-[#FF9F1C] shrink-0 mt-0.5" aria-hidden />
                  <p className="font-mono text-xs text-[#7A8896] leading-relaxed">
                    Contract deployment is pending; rewards remain locked until a Mission Control program ID is configured.
                  </p>
                </div>
              )}
            </div>

            <div className="border border-[#2A3340] bg-[#111820] rounded-lg p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ListChecks size={15} weight="bold" className="text-[#39FF14]" aria-hidden />
                <span className={SECTION_TITLE_CLASS}>
                  Bot Entry
                </span>
              </div>
              <div className="rounded-md border border-[#2A3340] bg-[#0A0E14] px-3 py-3">
                <EntryRow label="Program" value={snapshot.programHex ?? "not deployed"} />
                <EntryRow label="Discover" value="AanMissions/GetOpenMissions [null,10]" />
                <EntryRow label="Claim" value="AanMissions/ClaimMission [mission_id]" />
                <EntryRow label="Prove" value='AanMissions/SubmitProof [mission_id,"tx_hash","note"]' />
              </div>
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
