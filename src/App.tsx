import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, FormEvent, ReactNode, RefObject } from "react";
import Editor from "@monaco-editor/react";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { UseInViewOptions } from "framer-motion";
import Lenis from "lenis";
import { QRCodeSVG } from "qrcode.react";
import ceoAvatar from "./assets/team-mira-solen.svg";
import ctoAvatar from "./assets/team-tavian-ro.svg";
import productAvatar from "./assets/team-elowen-pike.svg";
import trustAvatar from "./assets/team-soren-vale.svg";
import {
  ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, BarChart3, BrainCircuit, Check,
  CheckCircle2, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Code2, Copy, ExternalLink,
  Eye, FileCode2, Flag, Home as HomeIcon, KeyRound, LayoutDashboard, Lightbulb, LockKeyhole, MessageSquareText, Plus,
  Radio, Shield, ShieldCheck, Sparkles, Upload, Users, WandSparkles, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./lib/api";
import type { Candidate, McqQuestion, TaskVariant, TimelineEvent, TrackDefinition, TrackResult, TracksCatalog } from "./types";

const ActivityChart = lazy(() => import("./ActivityChart"));

type AssessmentTrack = "problem-solver" | "skill" | "adapt";
type AssessmentProfile = { name: string; email: string; extraTime: boolean };
type AssessmentJourney = {
  journeyId: string | null;
  tracks: AssessmentTrack[];
  currentIndex: number;
  profile: AssessmentProfile | null;
  active: boolean;
  scores: Partial<Record<AssessmentTrack, number>>;
};
type AssessmentFlow = {
  journey: AssessmentJourney;
  startSingle: (track: AssessmentTrack) => void;
  startFull: () => void;
  rememberProfile: (profile: AssessmentProfile) => void;
  advance: (completedTrack: AssessmentTrack, score: number) => AssessmentTrack | null;
};
const emptyAssessmentJourney: AssessmentJourney = {
  journeyId: null,
  tracks: [],
  currentIndex: 0,
  profile: null,
  active: false,
  scores: {},
};
const AssessmentFlowContext = createContext<AssessmentFlow | null>(null);

function useAssessmentFlow() {
  const flow = useContext(AssessmentFlowContext);
  if (!flow) throw new Error("Assessment flow context is unavailable.");
  return flow;
}

const starterCode = `function groupBy(items, key) {
  // Return an object whose values are arrays of matching items.
  return items.reduce((groups, item) => {
    const value = item[key];
    (groups[value] ??= []).push(item);
    return groups;
  }, {});
}`;

const defaultTrackDomain: Record<AssessmentTrack, string> = {
  "problem-solver": "javascript",
  skill: "javascript",
  adapt: "javascript",
};

function starterForTask(variant: TaskVariant | null, domain: string) {
  if (variant?.starter) return variant.starter;
  if (variant?.field) {
    const functionName = `groupBy${variant.field[0].toUpperCase()}${variant.field.slice(1)}`;
    return `function ${functionName}(items) {\n  return items.reduce((groups, item) => {\n    const value = item.${variant.field};\n    (groups[value] ??= []).push(item);\n    return groups;\n  }, {});\n}`;
  }
  return domain === "javascript" ? starterCode : "";
}

function checksForWork(track: AssessmentTrack, domain: string, value: string, variant: TaskVariant | null, requirementSeen: boolean) {
  const text = value.toLowerCase();
  if (track === "problem-solver") {
    const tests = variant?.failingTests || ["Task-specific behavior", "Edge-case handling"];
    return tests.map((test) => {
      const label = test.toLowerCase();
      if (label.includes("round") || label.includes("currency")) return /math\.round|tofixed\s*\(\s*2\s*\)/i.test(value);
      if (label.includes("tax")) return /subtotal\s*\+\s*subtotal\s*\*\s*taxrate|subtotal\s*\*\s*\(\s*1\s*\+\s*taxrate|subtotal\s*\*\s*taxrate|taxrate\s*\*\s*subtotal/i.test(value);
      if (label.includes("empty") || label.includes("zero summary")) return /items\.length|if\s*\(\s*!items|items\?\.\s*length/i.test(value);
      if (label.includes("discount")) return /math\.(min|max)|discount\s*>\s*subtotal/i.test(value);
      if (label.includes("quantity")) return /quantity\s*[<]=?\s*0|number\.isfinite|throw new/i.test(value);
      if (label.includes("duplicated") || label.includes("fan-out")) return /distinct|group by|select\s+.+sum|subquery/i.test(value);
      if (label.includes("month")) return /calendar|cross join|coalesce|generate_series/i.test(value);
      return value.trim().length > 20;
    });
  }
  if (track === "adapt") {
    const isPractical = domain === "marketing" || domain === "accounting";
    const changedRequirementHandled = domain === "javascript"
      ? /unknown|missing|null|fallback|n\/a/i.test(text)
      : domain === "marketing"
        ? /budget|30\s*%|30 percent|audience|objective|performance/i.test(text)
        : /late|source|evidence|period|transaction|adjust/i.test(text);
    return [
      value.trim().length > 20,
      isPractical ? /\b(plan|reconcile|budget|transaction|audience|evidence)\b/i.test(value) : /\b(function|return|select|def)\b/i.test(value),
      requirementSeen && changedRequirementHandled,
    ];
  }
  if (track === "skill") {
    if (domain === "javascript" && variant?.field) {
      const fieldPattern = new RegExp(`(?:\\.${variant.field}\\b|\\[\\s*[\\"']${variant.field}[\\"']\\s*\\])`, "i");
      const createsGroups = /\b(push|set|map|group)\b|\?\?=/.test(text);
      const handlesMissing = /missing|unknown|undefined|null|object\.create\s*\(\s*null\s*\)|new map|hasown/i.test(text);
      return [fieldPattern.test(value), createsGroups, handlesMissing];
    }
    if (domain === "python") return [
      /def\s+clean_contacts\s*\(/i.test(value),
      /name|email/i.test(text) && /strip|lower|normalize|clean/i.test(text),
      /missing|duplicate|valid|invalid|preserv/i.test(text),
    ];
    if (domain === "sql") return [
      /\bselect\b/i.test(value) && /\bfrom\b/i.test(value),
      /count\s*\(\s*distinct\s+customer_id\s*\)/i.test(value),
      /group\s+by/i.test(value) && /cohort_month/i.test(value),
    ];
    if (domain === "marketing") return [
      /audience/i.test(text) && /channel/i.test(text),
      /budget/i.test(text) && /split|allocat|percent|\$/i.test(text),
      /measure|metric|conversion|outcome|baseline/i.test(text),
    ];
    if (domain === "accounting") return [
      /statement|transaction/i.test(text),
      /discrepanc|adjustment/i.test(text) && /source|evidence|document/i.test(text),
      /opening|closing|balance/i.test(text),
    ];
  }
  return [
    value.trim().length > 20,
    domain === "javascript" ? /function|=>|return/.test(value) : domain === "python" ? /def |return /.test(value) : domain === "sql" ? /select |from |group by/i.test(value) : value.trim().split(/\n/).filter((line) => line.trim().length > 0).length >= 3,
    /\b(test|edge|verify|check|missing|empty|distinct|measure|evidence)\b/i.test(value),
  ];
}

function trackSignals(candidate: Candidate, liveCheck: number, explanation = "") {
  const scoredAnswers = candidate.viva.map((answer) => answer.score).filter((score): score is number => score !== null);
  const viva = scoredAnswers.length
    ? Math.round(scoredAnswers.reduce((sum, score) => sum + score, 0) / scoredAnswers.length)
    : Math.min(100, explanation.trim().length ? 45 + Math.floor(explanation.trim().length / 4) : 0);
  const editCount = candidate.events.reduce((sum, event) => sum + (event.type === "edit" ? event.count : 0), 0);
  const testRuns = candidate.events.filter((event) => event.type === "run").length;
  const process = Math.min(100, 35 + editCount * 3 + testRuns * 8);
  const prompts = candidate.ai_prompts;
  const aiUsage = prompts.length
    ? Math.round(65 + prompts.filter((item) => item.verified).length / prompts.length * 20 +
      prompts.filter((item) => item.seeded_mistake && (item.caught || item.edited_after)).length / prompts.length * 15)
    : 75;
  return {
    viva,
    process,
    aiUsage,
    liveCheck,
    timeAndPaste: 75,
  };
}

function Logo({ small = false }: { small?: boolean }) {
  return <Link to="/" className="brand-link flex items-center gap-2.5 font-semibold tracking-tight">
    <span className="brand-mark grid size-9 place-items-center rounded-xl"><ShieldCheck size={19} strokeWidth={2.2} /></span>
    {!small && <span className="text-[17px]">futurefit<span className="brand-period">.</span></span>}
  </Link>;
}

function TopNav({ dashboard = false }: { dashboard?: boolean }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (latest) => {
    const next = latest > 20;
    setScrolled((current) => current === next ? current : next);
  });

  return <header className={`top-nav sticky top-0 z-30 border-b backdrop-blur-xl${scrolled ? " top-nav-scrolled" : ""}`}>
    <div className={`top-nav-inner mx-auto flex ${scrolled ? "h-[62px]" : "h-[68px]"} max-w-[1240px] items-center justify-between px-5 lg:px-8`}>
      <Logo />
      <nav aria-label="Main navigation" className="hidden items-center gap-5 text-[13px] md:flex">
        <Link to="/" title="Home" aria-label="Home" className="flex items-center gap-2 transition"><HomeIcon size={15} /> Home</Link>
        <Link to="/assessments" title="Assessments" aria-label="Assessments" className="flex items-center gap-2 transition"><ClipboardCheck size={15} /> Assessments</Link>
        <Link to="/hr" title="HR Dashboard" aria-label="HR Dashboard" aria-current={dashboard ? "page" : undefined} className="flex items-center gap-2 transition"><LayoutDashboard size={15} /> HR Dashboard</Link>
        <Link to="/verify" title="Verify credential" aria-label="Verify credential" className="flex items-center gap-2 transition"><BadgeCheck size={15} /> Verify credential</Link>
      </nav>
      <div className="flex items-center gap-3">
        <Link to="/assessments" title="Try the demo" aria-label="Try the demo" className="nav-cta primary-glow inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[13px] font-semibold text-white transition md:px-4">
          <Code2 size={15} /><span className="hidden md:inline">Try the demo</span><ArrowRight className="hidden md:block" size={14} />
        </Link>
      </div>
    </div>
    <nav aria-label="Mobile navigation" className="mobile-nav mx-auto flex max-w-[1240px] gap-5 overflow-x-auto px-5 pb-3 text-xs md:hidden lg:px-8">
      <Link to="/" title="Home" aria-label="Home" className="flex shrink-0 items-center gap-2"><HomeIcon size={16} />Home</Link>
      <Link to="/assessments" title="Assessments" aria-label="Assessments" className="flex shrink-0 items-center gap-2"><ClipboardCheck size={16} />Assessments</Link>
      <Link to="/hr" title="HR Dashboard" aria-label="HR Dashboard" className="flex shrink-0 items-center gap-2"><LayoutDashboard size={16} />HR Dashboard</Link>
      <Link to="/verify" title="Verify credential" aria-label="Verify credential" className="flex shrink-0 items-center gap-2"><BadgeCheck size={16} />Verify credential</Link>
    </nav>
  </header>;
}

function summarizePrompt(prompt: string) {
  const text = prompt.toLowerCase();
  if (/\b(write|generate|solve|complete solution|give me (the )?(code|solution))\b/.test(text)) {
    return "Direct solution request; review the viva and replay to understand how the candidate evaluated the suggestion.";
  }
  if (/\b(explain|why|how|compare|tradeoff|edge case|complexity|review|verify|check)\b/.test(text)) {
    return "Asked for an explanation, comparison, or verification rather than a complete solution.";
  }
  return "Prompt content is available as context for the reviewer.";
}

function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const statuses = [
    "Initializing secure session...",
    "Loading assessment engine...",
    "Verifying process signals...",
  ];

  useEffect(() => {
    const progressInterval = window.setInterval(() => {
      setProgress((current) => Math.min(current + 7, 100));
    }, 100);
    const statusInterval = reduceMotion ? undefined : window.setInterval(() => {
      setStatusIndex((current) => (current + 1) % statuses.length);
    }, 500);

    return () => {
      window.clearInterval(progressInterval);
      if (statusInterval !== undefined) window.clearInterval(statusInterval);
    };
  }, [reduceMotion, statuses.length]);

  return <motion.div
    className={`loading-screen${reduceMotion ? " loading-screen-reduced" : ""}`}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: reduceMotion ? 0.2 : 0.35 }}
    aria-busy="true"
  >
    <div className="loading-content">
      <div className="loading-emblem" aria-hidden="true">
        <motion.div
          className="loading-orbit loading-orbit-outer"
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 7, ease: "linear", repeat: Infinity }}
        />
        <motion.div
          className="loading-orbit loading-orbit-inner"
          animate={reduceMotion ? undefined : { rotate: -360 }}
          transition={{ duration: 5, ease: "linear", repeat: Infinity }}
        />
        <div className="loading-shield"><ShieldCheck size={39} strokeWidth={1.5} /></div>
      </div>
      <div className="loading-brand">futurefit<span>.</span></div>
      <p className="loading-copy">Secure assessment workspace</p>
      <div className="loading-progress-row">
        <div
          className="loading-bar"
          role="progressbar"
          aria-label="Loading FutureFit"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <motion.span
            animate={{ width: `${progress}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.12, ease: "linear" }}
          />
        </div>
        <span className="loading-percentage">{progress}%</span>
      </div>
      <div className="loading-status" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={reduceMotion ? statuses[0] : statuses[statusIndex]}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -5 }}
            transition={{ duration: reduceMotion ? 0.15 : 0.2 }}
          >
            {reduceMotion ? statuses[0] : statuses[statusIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  </motion.div>;
}

function SkeletonLoader({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton-loader ${className}`} />;
}

function ScrollReveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const simpleFade = reduceMotion === true;
  return <motion.div
    className={className}
    initial={{ opacity: 0, y: simpleFade ? 0 : 16, filter: simpleFade ? "blur(0px)" : "blur(6px)" }}
    whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    viewport={{ once: true, amount: 0.18 }}
    transition={{ duration: simpleFade ? 0.2 : 0.55, delay: simpleFade ? 0 : delay, ease: "easeOut" }}
  >
    {children}
  </motion.div>;
}

function ScrollEffects() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();

  useEffect(() => {
    if (reduceMotion !== false) return;
    const lenis = new Lenis({
      anchors: true,
      autoRaf: true,
      lerp: 0.09,
      respectReducedMotion: true,
      smoothWheel: true,
    });
    return () => lenis.destroy();
  }, [reduceMotion]);

  return <motion.div className="scroll-progress" style={{ scaleX: scrollYProgress }} aria-hidden="true" />;
}

type HowStep = { number: string; icon: typeof ClipboardCheck; title: string; text: string; color: string };
type CenterMargin = NonNullable<UseInViewOptions["margin"]>;

function StepTimelineItem({ step }: { step: HowStep }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [centerMargin, setCenterMargin] = useState<CenterMargin>("-180px 0px -180px 0px");
  const isActive = useInView(ref, { margin: centerMargin, amount: 0.15 });
  const reduceMotion = useReducedMotion() === true;
  const Icon = step.icon;

  useEffect(() => {
    const updateCenterMargin = () => {
      const centerBand = Math.min(160, Math.round(window.innerHeight * 0.18));
      const inset = Math.round((window.innerHeight - centerBand) / 2);
      setCenterMargin(`-${inset}px 0px -${inset}px 0px` as CenterMargin);
    };
    updateCenterMargin();
    window.addEventListener("resize", updateCenterMargin);
    return () => window.removeEventListener("resize", updateCenterMargin);
  }, []);

  return <motion.div
    ref={ref}
    className="step-timeline-item"
    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
    animate={reduceMotion
      ? { opacity: isActive ? 1 : 0.72 }
      : { opacity: isActive ? 1 : 0.72, y: isActive ? 0 : 5, scale: isActive ? 1 : 0.985 }}
    transition={{ duration: reduceMotion ? 0.2 : 0.4, ease: "easeOut" }}
  >
    <span className={`steps-timeline-marker${isActive ? ` is-active${reduceMotion ? " is-reduced" : ""}` : ""}`} aria-hidden="true">{step.number}</span>
    <article className={`step-card accent-${step.color}`}>
      <div className="step-card-top"><span className="step-icon"><Icon size={19} /></span></div>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="step-decoration" />
    </article>
  </motion.div>;
}

function StepsTimeline({ steps }: { steps: HowStep[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 40%"] });
  const lineProgress = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const reduceMotion = useReducedMotion() === true;

  return <div ref={ref} className="steps-grid">
    <div className="steps-timeline-track" aria-hidden="true">
      <motion.div className="steps-timeline-fill" style={{ scaleY: reduceMotion ? 1 : lineProgress }} />
    </div>
    {steps.map((step) => <StepTimelineItem key={step.number} step={step} />)}
  </div>;
}

function CountUpStat({ value, label, delay }: { value: number; label: string; delay: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref, { once: true, amount: 0.6 });
  const count = useMotionValue(0);
  const roundedCount = useTransform(count, (current) => Math.round(current));
  const reduceMotion = useReducedMotion() === true;

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(count, value, { duration: reduceMotion ? 0 : 0.9, ease: "easeOut" });
    return () => controls.stop();
  }, [count, isInView, reduceMotion, value]);

  return <motion.div
    ref={ref}
    className="stats-item"
    initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.6 }}
    transition={{ duration: reduceMotion ? 0.2 : 0.4, delay: reduceMotion ? 0 : delay, ease: "easeOut" }}
    aria-label={`${value} ${label}`}
  >
    <span className="stats-number" aria-hidden="true"><motion.span>{roundedCount}</motion.span></span>
    <span className="stats-label">{label}</span>
  </motion.div>;
}

function FeatureCard({ item, index }: { item: { icon: LucideIcon; title: string; text: string; accent: string }; index: number }) {
  const reduceMotion = useReducedMotion() === true;
  const Icon = item.icon;

  return <motion.div
    className="evidence-reveal"
    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, rotateX: 8, rotateY: index % 2 ? 6 : -6, scale: 0.97 }}
    whileInView={reduceMotion
      ? { opacity: 1 }
      : { opacity: 1, y: 0, rotateX: 0, rotateY: 0, scale: 1 }}
    viewport={{ once: true, amount: 0.22 }}
    transition={{ duration: reduceMotion ? 0.2 : 0.46, delay: reduceMotion ? 0 : index * 0.035, ease: "easeOut" }}
  >
    <article
      className={`evidence-card accent-${item.accent}`}
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
        event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.setProperty("--pointer-x", "50%");
        event.currentTarget.style.setProperty("--pointer-y", "50%");
      }}
    >
      <span className="evidence-icon"><Icon size={17} /></span><span className="evidence-index">0{index + 1}</span><h3>{item.title}</h3><p>{item.text}</p><ArrowRight className="evidence-arrow" size={16} />
    </article>
  </motion.div>;
}

function BeforeAfterSection({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref, { once: true, amount: 0.25 });
  const reduceMotion = useReducedMotion() === true;
  const beforeItems = [
    "One polished output leaves the process out",
    "AI activity can be misread in isolation",
    "Generic tasks miss how someone adapts",
  ];
  const afterItems = [
    "Practical work shows the candidate's approach",
    "Process and AI use are reviewed in context",
    "Human reviewers consider multiple signals",
  ];

  return <section ref={sectionRef} id="solution" className="comparison-section" aria-labelledby="comparison-heading">
    <ScrollReveal className="comparison-heading">
      <span className="section-kicker">A CLEARER WAY TO SEE SKILL</span>
      <h2 id="comparison-heading">Beyond a single answer.</h2>
      <p>Good decisions come from context, process, and human review.</p>
    </ScrollReveal>
    <div ref={ref} className="before-after-grid">
      <motion.article
        className="comparison-card comparison-before"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -34 }}
        animate={isInView ? { opacity: 1, x: 0 } : undefined}
        transition={{ duration: reduceMotion ? 0.2 : 0.54, ease: "easeOut" }}
      >
        <span className="comparison-kicker">BEFORE</span>
        <h3>A snapshot, not the story</h3>
        <ul>{beforeItems.map((item) => <li key={item}><X size={14} aria-hidden="true" />{item}</li>)}</ul>
      </motion.article>
      <div className={`before-after-divider${reduceMotion ? " is-reduced" : ""}`} aria-hidden="true">
        <motion.span className="before-after-divider-vertical" initial={reduceMotion ? { opacity: 0 } : { scaleY: 0 }} animate={reduceMotion ? { opacity: isInView ? 1 : 0 } : { scaleY: isInView ? 1 : 0 }} transition={{ duration: reduceMotion ? 0.2 : 0.68, ease: "easeInOut" }} />
        <motion.span className="before-after-divider-horizontal" initial={reduceMotion ? { opacity: 0 } : { scaleX: 0 }} animate={reduceMotion ? { opacity: isInView ? 1 : 0 } : { scaleX: isInView ? 1 : 0 }} transition={{ duration: reduceMotion ? 0.2 : 0.68, ease: "easeInOut" }} />
      </div>
      <motion.article
        className="comparison-card comparison-after"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 34 }}
        animate={isInView ? { opacity: 1, x: 0 } : undefined}
        transition={{ duration: reduceMotion ? 0.2 : 0.54, delay: reduceMotion ? 0 : 0.08, ease: "easeOut" }}
      >
        <span className="comparison-kicker">WITH FUTUREFIT</span>
        <h3>A fuller view of real skill</h3>
        <ul>{afterItems.map((item) => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>
      </motion.article>
    </div>
  </section>;
}

function FinalCta() {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref, { once: true, amount: 0.35 });
  const reduceMotion = useReducedMotion() === true;

  return <section className="final-cta-section" aria-label="Get started with FutureFit">
    <motion.div
      ref={ref}
      className="final-cta-banner"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={isInView ? { opacity: 1, scale: 1 } : undefined}
      transition={{ duration: reduceMotion ? 0.2 : 0.54, ease: "easeOut" }}
    >
      <motion.div
        className="final-cta-gradient"
        initial={{ backgroundPosition: "0% 50%" }}
        animate={isInView && !reduceMotion ? { backgroundPosition: "100% 50%" } : undefined}
        transition={{ duration: 0.72, ease: "easeOut" }}
        aria-hidden="true"
      />
      <div className="final-cta-copy">
        <span className="final-cta-kicker">READY TO SEE THE WHOLE STORY?</span>
        <h2>Make room for real skill.</h2>
        <p>Explore a practical, human-first way to understand how candidates work.</p>
      </div>
      <Link to="/assessments" className="final-cta-link">Try the live demo <ArrowRight size={16} /></Link>
    </motion.div>
  </section>;
}

type OutlineSection = { label: string; id: string; sectionRef: RefObject<HTMLElement | null> };

function OutlineWheelItem({ section, index, activeIndex, onActiveChange, reduceMotion }: {
  section: OutlineSection;
  index: number;
  activeIndex: number;
  onActiveChange: (index: number) => void;
  reduceMotion: boolean;
}) {
  const { scrollYProgress } = useScroll({
    target: section.sectionRef,
    offset: ["start 82%", "end 18%"],
  });
  const previousProgress = useRef(scrollYProgress.get());
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.5, 0.8, 1], [0.32, 0.5, 1, 0.5, 0.32]);
  const color = useTransform(scrollYProgress, [0, 0.2, 0.5, 0.8, 1], ["#77777e", "#a1a1a6", "#ffffff", "#a1a1a6", "#77777e"]);
  const isActive = activeIndex === index;
  const distance = index - activeIndex;

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const previous = previousProgress.current;
    if ((previous < 0.5 && latest >= 0.5) || (previous > 0.5 && latest <= 0.5)) {
      onActiveChange(index);
    }
    previousProgress.current = latest;
  });

  useEffect(() => {
    const current = scrollYProgress.get();
    if (current >= 0.4 && current <= 0.6) onActiveChange(index);
  }, [index, onActiveChange, scrollYProgress]);

  return <motion.li
    className={`outline-wheel-item${isActive ? " is-active" : ""}`}
    animate={{
      x: reduceMotion ? 0 : Math.sin(distance * 0.48) * 18,
      scale: reduceMotion || isActive ? 1 : 0.96,
    }}
    style={{
      opacity: reduceMotion ? (isActive ? 1 : 0.46) : (isActive ? 1 : opacity),
      color: reduceMotion || isActive ? (isActive ? "#ffffff" : "#85858b") : color,
    }}
    transition={{ duration: reduceMotion ? 0.16 : 0.34, ease: "easeOut" }}
  >
    <a className="outline-wheel-link" href={`#${section.id}`} aria-current={isActive ? "location" : undefined} onClick={() => onActiveChange(index)}>
      <motion.span className="outline-wheel-arrow" aria-hidden="true" animate={{ opacity: isActive ? 1 : 0 }} transition={{ duration: reduceMotion ? 0.12 : 0.22 }}>
        <ArrowRight size={12} />
      </motion.span>
      <span>{section.label}</span>
    </a>
  </motion.li>;
}

function OutlineWheel({ sections, activeIndex, onActiveChange }: {
  sections: OutlineSection[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
}) {
  const reduceMotion = useReducedMotion() === true;

  return <nav className="outline-wheel" aria-label="Page outline">
    <ul className="outline-wheel-list">
      {sections.map((section, index) => <OutlineWheelItem
        key={section.id}
        section={section}
        index={index}
        activeIndex={activeIndex}
        onActiveChange={onActiveChange}
        reduceMotion={reduceMotion}
      />)}
    </ul>
  </nav>;
}

type HeroPreviewMode = "assessment" | "process" | "viva" | "credential";

function HeroProductPreview({ mode }: { mode: HeroPreviewMode }) {
  const modeLabels: Record<HeroPreviewMode, string> = {
    assessment: "ASSESSMENT · TASK 01",
    process: "PROCESS REPLAY · SESSION 01",
    viva: "VIVA · FOLLOW-UP",
    credential: "VERIFIED CREDENTIAL",
  };
  const sidebar = [
    { icon: Code2, label: "Assessment", active: mode === "assessment" },
    { icon: Radio, label: "Process replay", active: mode === "process" },
    { icon: MessageSquareText, label: "Viva", active: mode === "viva" },
    { icon: BadgeCheck, label: "Credential", active: mode === "credential" },
  ];

  return <div className="product-window hero-preview-window">
    <div className="window-topbar">
      <div className="window-dots"><i /><i /><i /></div>
      <span>FUTUREFIT / CANDIDATE WORKSPACE</span>
      <span className="window-secure"><ShieldCheck size={12} /> PRIVATE</span>
    </div>
    <div className="product-content">
      <div className="product-sidebar">
        <span className="sidebar-mark"><ShieldCheck size={17} /></span>
        {sidebar.map(({ icon: Icon, label, active }) => <span key={label} className={active ? "sidebar-active" : ""} aria-label={label}><Icon size={15} /></span>)}
      </div>
      <div className="product-main">
        {mode === "assessment" && <>
          <div className="product-heading"><div><span className="product-kicker">{modeLabels[mode]}</span><h3>Group items by key</h3></div><span className="task-status"><i /> IN PROGRESS</span></div>
          <div className="code-preview">
            <div className="code-tabs"><span>solution.js</span><span>⌘</span></div>
            <pre><span className="code-muted">01</span> <span className="code-purple">function</span> groupBy(items, key) {"{"}{"\n"}<span className="code-muted">02</span>   <span className="code-purple">return</span> items.<span className="code-yellow">reduce</span>((groups, item) =&gt; {"{"}{"\n"}<span className="code-muted">03</span>     <span className="code-purple">const</span> value = item[key];{"\n"}<span className="code-muted">04</span>     (groups[value] ??= []).<span className="code-yellow">push</span>(item);{"\n"}<span className="code-muted">05</span>     <span className="code-purple">return</span> groups;{"\n"}<span className="code-muted">06</span>   {"}"}, {"{}"});{"\n"}<span className="code-muted">07</span> {"}"}</pre>
          </div>
          <div className="product-foot"><span><Eye size={13} /> Candidate-consented process</span><span>00:18:42</span></div>
        </>}
        {mode === "process" && <>
          <div className="product-heading"><div><span className="product-kicker">{modeLabels[mode]}</span><h3>How the solution came together</h3></div><span className="task-status"><i /> REVIEW READY</span></div>
          <div className="preview-timeline">
            <div className="preview-timeline-row"><time>09:14</time><i /><div><strong>Outlined an approach</strong><small>Started with a clear grouping strategy</small></div></div>
            <div className="preview-timeline-row"><time>09:21</time><i /><div><strong>Refined the logic</strong><small>Adjusted the solution for edge cases</small></div></div>
            <div className="preview-timeline-row"><time>09:32</time><i /><div><strong>Validated the result</strong><small>Checked empty and repeated values</small></div></div>
          </div>
          <div className="product-foot"><span><Eye size={13} /> Evidence in context</span><span>18 min</span></div>
        </>}
        {mode === "viva" && <>
          <div className="product-heading"><div><span className="product-kicker">{modeLabels[mode]}</span><h3>Explain the trade-off</h3></div><span className="task-status"><i /> COMPLETE</span></div>
          <div className="preview-viva">
            <div className="preview-viva-message"><span>REVIEWER</span><p>What would you change if the input grew significantly?</p></div>
            <div className="preview-viva-message is-candidate"><span>CANDIDATE</span><p>I’d consider streaming the items, while keeping each group’s order intact.</p></div>
          </div>
          <div className="product-foot"><span><MessageSquareText size={13} /> Reasoning, in their own words</span><span>02:16</span></div>
        </>}
        {mode === "credential" && <>
          <div className="product-heading"><div><span className="product-kicker">{modeLabels[mode]}</span><h3>Assessment complete</h3></div><span className="task-status"><i /> VERIFIED</span></div>
          <div className="preview-credential">
            <span className="preview-credential-icon"><ShieldCheck size={27} /></span>
            <div><strong>FutureFit credential</strong><small>Practical skill · Process · Viva</small></div>
            <span className="preview-credential-check"><CheckCircle2 size={17} /></span>
          </div>
          <div className="product-foot"><span><BadgeCheck size={13} /> Shareable evidence record</span><span>FF-2048</span></div>
        </>}
      </div>
    </div>
    <div className="product-bottom"><span>ASSESSMENT SIGNALS</span><div><i className="signal-green" /><i className="signal-pink" /><i className="signal-yellow" /><i className="signal-blue" /></div><strong>{mode === "credential" ? "Credential verified" : "4 signals in context"}</strong></div>
  </div>;
}

function Home() {
  const heroRef = useRef<HTMLElement | null>(null);
  const problemRef = heroRef;
  const howRef = useRef<HTMLElement | null>(null);
  const featuresRef = useRef<HTMLElement | null>(null);
  const solutionRef = useRef<HTMLElement | null>(null);
  const teamRef = useRef<HTMLElement | null>(null);
  const [activeOutlineIndex, setActiveOutlineIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState<HeroPreviewMode>("assessment");
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const { scrollYProgress: processPreviewProgress } = useScroll({ target: howRef, offset: ["start 82%", "end 18%"] });
  const { scrollYProgress: vivaPreviewProgress } = useScroll({ target: featuresRef, offset: ["start 82%", "end 18%"] });
  const { scrollYProgress: credentialPreviewProgress } = useScroll({ target: solutionRef, offset: ["start 82%", "end 18%"] });
  const previousProcessProgress = useRef(processPreviewProgress.get());
  const previousVivaProgress = useRef(vivaPreviewProgress.get());
  const previousCredentialProgress = useRef(credentialPreviewProgress.get());
  const headlineOpacity = useTransform(heroProgress, [0, 0.72], [1, 0]);
  const headlineScale = useTransform(heroProgress, [0, 0.72], [1, 0.95]);
  const mockupY = useTransform(heroProgress, [0, 1], [0, -76]);
  const visualY = useTransform(heroProgress, [0, 1], [0, -36]);
  const processNoteY = useTransform(heroProgress, [0, 1], [0, -112]);
  const scoreNoteY = useTransform(heroProgress, [0, 1], [0, -22]);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useTransform(pointerY, [-1, 1], [7, -7]);
  const rotateY = useTransform(pointerX, [-1, 1], [-9, 9]);
  const reduceMotion = useReducedMotion() === true;
  useMotionValueEvent(processPreviewProgress, "change", (progress) => {
    const previous = previousProcessProgress.current;
    if (previous < 0.5 && progress >= 0.5) setPreviewMode("process");
    if (previous >= 0.5 && progress < 0.5) setPreviewMode("assessment");
    previousProcessProgress.current = progress;
  });
  useMotionValueEvent(vivaPreviewProgress, "change", (progress) => {
    const previous = previousVivaProgress.current;
    if (previous < 0.5 && progress >= 0.5) setPreviewMode("viva");
    if (previous >= 0.5 && progress < 0.5) setPreviewMode("process");
    previousVivaProgress.current = progress;
  });
  useMotionValueEvent(credentialPreviewProgress, "change", (progress) => {
    const previous = previousCredentialProgress.current;
    if (previous < 0.5 && progress >= 0.5) setPreviewMode("credential");
    if (previous >= 0.5 && progress < 0.5) setPreviewMode("viva");
    previousCredentialProgress.current = progress;
  });
  const steps: HowStep[] = [
    { number: "01", icon: ClipboardCheck, title: "A real task", text: "Candidates work on the same practical challenge in a focused workspace.", color: "mint" },
    { number: "02", icon: Radio, title: "Process, not just output", text: "With consent, see how an idea takes shape through edits and decisions.", color: "pink" },
    { number: "03", icon: MessageSquareText, title: "A thoughtful viva", text: "Candidates explain their choices and edge cases in their own words.", color: "yellow" },
    { number: "04", icon: BadgeCheck, title: "Evidence you can trust", text: "Review a balanced report and share a verified credential.", color: "blue" },
  ];
  const evidence = [
    { icon: Radio, title: "Process replay", text: "A clear timeline of edits, pastes, timing, and focus changes.", accent: "mint" },
    { icon: MessageSquareText, title: "AI viva", text: "A short conversation about decisions, trade-offs, and edge cases.", accent: "pink" },
    { icon: Sparkles, title: "AI, in context", text: "Prompts add context; thoughtful checking matters more than avoidance.", accent: "yellow" },
    { icon: WandSparkles, title: "Adaptability", text: "A changed requirement shows how candidates respond to new constraints.", accent: "blue" },
    { icon: Code2, title: "Live skill check", text: "A timed debugging follow-up with transparent test results.", accent: "pink" },
    { icon: Shield, title: "Responsible analysis", text: "Text-style observations are weak context and add zero score points.", accent: "mint" },
  ];
  const team = [
    { name: "Mira Solen", role: "CEO", bio: "Builds people-first hiring experiences grounded in clear evidence.", avatar: ceoAvatar },
    { name: "Tavian Ro", role: "CTO", bio: "Turns thoughtful assessment ideas into reliable, privacy-aware tools.", avatar: ctoAvatar },
    { name: "Elowen Pike", role: "Head of Product", bio: "Shapes focused workflows that help candidates show their thinking.", avatar: productAvatar },
    { name: "Soren Vale", role: "Head of Trust & Safety", bio: "Keeps fairness, consent, and transparency central to every review.", avatar: trustAvatar },
  ];
  const outlineSections: OutlineSection[] = [
    { label: "Problem", id: "problem", sectionRef: problemRef },
    { label: "How it works", id: "how-it-works", sectionRef: howRef },
    { label: "Features", id: "features", sectionRef: featuresRef },
    { label: "Solution", id: "solution", sectionRef: solutionRef },
    { label: "Team", id: "team", sectionRef: teamRef },
  ];
  return <div className="landing-page min-h-screen">
    <motion.div className="hero-intro-curtain" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0.2 : 0.72, ease: "easeOut" }} aria-hidden="true" />
    <TopNav />
    <OutlineWheel sections={outlineSections} activeIndex={activeOutlineIndex} onActiveChange={setActiveOutlineIndex} />
    <main>
      <section ref={heroRef} id="problem" className="landing-hero">
        <ScrollReveal className="landing-hero-inner">
          <motion.div className="hero-copy" style={reduceMotion ? { opacity: headlineOpacity } : { opacity: headlineOpacity, scale: headlineScale }}>
            <div className="hero-eyebrow"><span /> THE HUMAN SIDE OF TECH HIRING</div>
            <motion.h1
              className="hero-intro-title"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.2 : 0.65, delay: reduceMotion ? 0 : 0.96, ease: "easeOut" }}
            >See the thinking.<br />Meet the <span>real talent.</span></motion.h1>
            <p>Great hiring is more than a perfect answer. FutureFit brings the process, reasoning, and practical skill into one clear picture — with AI treated as a tool, not a verdict.</p>
            <div className="hero-actions">
              <Link to="/assessments" className="hero-primary primary-glow">Try the live demo <ArrowRight size={16} /></Link>
              <a href="#how-it-works" className="hero-secondary">Explore the platform <ArrowDownRight size={16} /></a>
            </div>
            <div className="hero-trust">
              <div className="avatar-stack"><span>M</span><span>L</span><span>A</span><span>+</span></div>
              <div><strong>Better signal, fairer hiring</strong><small>Designed for real people, not perfect prompts.</small></div>
            </div>
          </motion.div>
          <motion.div className="hero-visual" style={reduceMotion ? undefined : { y: visualY }}>
            <div className="visual-orbit orbit-pink" />
            <div className="visual-orbit orbit-teal" />
            <motion.div className="floating-note note-process" style={reduceMotion ? undefined : { y: processNoteY }}><span className="live-dot" /><div><strong>Process replay</strong><small>Thoughtful edits · 18 min</small></div><Radio size={17} /></motion.div>
            <motion.div className="product-window-parallax" style={reduceMotion ? undefined : { y: mockupY }}>
              <motion.div
                className="hero-preview-card"
                style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 1100 }}
                onMouseMove={reduceMotion ? undefined : (event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  pointerX.set((event.clientX - bounds.left) / bounds.width * 2 - 1);
                  pointerY.set((event.clientY - bounds.top) / bounds.height * 2 - 1);
                }}
                onMouseLeave={() => {
                  pointerX.set(0);
                  pointerY.set(0);
                }}
              >
                <svg className="hero-frame-brackets" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
                  {["M82 18H20V80", "M918 18H980V80", "M20 520V582H82", "M980 520V582H918"].map((path) => <motion.path key={path} d={path} initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduceMotion ? 0 : 0.68, delay: reduceMotion ? 0 : 0.22, ease: "easeInOut" }} />)}
                </svg>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={previewMode}
                    className="hero-preview-swap"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(3px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -5, filter: "blur(2px)" }}
                    transition={{ duration: reduceMotion ? 0.16 : 0.38, ease: "easeOut" }}
                  >
                    <HeroProductPreview mode={previewMode} />
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            </motion.div>
            <motion.div className="floating-note note-score" style={reduceMotion ? undefined : { y: scoreNoteY }}><span className="score-orb"><Sparkles size={16} /></span><div><small>Understanding score</small><strong>92 <em>/ 100</em></strong></div><span className="score-trend">+12%</span></motion.div>
            <div className="visual-caption"><span>01</span> A clearer view of real skill <i /></div>
          </motion.div>
        </ScrollReveal>
      </section>
      <section className="brand-strip" aria-label="FutureFit principles">
        <ScrollReveal><span>BUILT FOR BETTER HIRING</span><strong>Human-first</strong><i /> <strong>Evidence-led</strong><i /> <strong>AI-aware</strong><i /> <strong>Fair by design</strong></ScrollReveal>
      </section>
      <section className="stats-strip" aria-label="FutureFit at a glance">
        <ScrollReveal className="stats-grid">
          <CountUpStat value={6} label="Assessment signals" delay={0} />
          <CountUpStat value={4} label="Assessment stages" delay={0.1} />
          <CountUpStat value={0} label="AI-text scoring points" delay={0.2} />
        </ScrollReveal>
      </section>

      <section ref={howRef} id="how-it-works" className="how-section">
        <ScrollReveal className="section-heading">
          <div><span className="section-kicker">FROM FIRST LINE TO FULL PICTURE</span><h2>A better way to<br /><span>see what people can do.</span></h2></div>
          <p>One polished answer can’t tell the whole story. We bring together practical work, real reasoning, and human review.</p>
        </ScrollReveal>
        <StepsTimeline steps={steps} />
      </section>

      <section ref={featuresRef} id="features" className="evidence-section">
        <ScrollReveal className="evidence-heading"><span className="section-kicker">THE WHOLE STORY, NOT JUST THE SUBMISSION</span><h2>Six signals.<br /><span>One human decision.</span></h2><p>Each signal adds context. None is treated as proof of authorship or a standalone hiring decision.</p></ScrollReveal>
        <ScrollReveal className="evidence-grid">{evidence.map((item, index) => <FeatureCard key={item.title} item={item} index={index} />)}</ScrollReveal>
        <ScrollReveal className="fairness-note"><span className="fairness-icon"><ShieldCheck size={18} /></span><p><strong>AI use is context, not a verdict.</strong> We never reject candidates based on AI activity alone. Review the evidence, then make a fair, informed decision.</p><Link to="/dashboard">How we keep it fair <ArrowRight size={14} /></Link></ScrollReveal>
      </section>

      <BeforeAfterSection sectionRef={solutionRef} />

      <section id="principles" className="principles-section">
        <ScrollReveal className="principles-copy"><span className="section-kicker">DESIGNED AROUND PEOPLE</span><h2>Make room for<br /><span>the human part.</span></h2><p>Candidates deserve a chance to show how they think. Hiring teams deserve evidence they can actually discuss.</p><Link to="/dashboard" className="principles-link">Explore the hiring workspace <ArrowRight size={15} /></Link></ScrollReveal>
        <ScrollReveal className="principles-card">
          <div className="principles-card-head"><span className="principles-emblem"><Users size={18} /></span><div><strong>Fairness, built in</strong><small>A more thoughtful candidate experience</small></div><span className="principles-live">LIVE</span></div>
          <div className="fair-step"><span>01</span><div><strong>Clear from the start</strong><small>Candidates know what is collected and why.</small></div><BadgeCheck size={18} /></div>
          <div className="fair-step"><span>02</span><div><strong>AI is never the judge</strong><small>Human review stays at the center.</small></div><ShieldCheck size={18} /></div>
          <div className="fair-step"><span>03</span><div><strong>Evidence, not surveillance</strong><small>No camera, microphone, or browsing history.</small></div><Eye size={18} /></div>
          <div className="principles-card-foot"><span><i /> TRUST BY DESIGN</span><span>FUTUREFIT · 2026</span></div>
        </ScrollReveal>
      </section>
      <section ref={teamRef} id="team" className="team-section" aria-labelledby="team-heading">
        <ScrollReveal className="team-heading">
          <span className="section-kicker">THE PEOPLE BEHIND THE PLATFORM</span>
          <h2 id="team-heading">Meet the team</h2>
          <p>A small, fictional team built around thoughtful, evidence-led hiring.</p>
        </ScrollReveal>
        <ScrollReveal className="team-grid">{team.map(({ name, role, bio, avatar }, index) => <ScrollReveal key={name} className="scroll-reveal-item" delay={index * 0.07}>
          <article className="team-card">
            <img className="team-avatar" src={avatar} alt="" aria-hidden="true" />
            <div className="team-card-copy">
              <h3>{name}</h3>
              <p className="team-role">{role}</p>
              <p className="team-bio">{bio}</p>
            </div>
          </article>
        </ScrollReveal>)}</ScrollReveal>
        <ScrollReveal className="team-footnote">Illustrative team for demo purposes.</ScrollReveal>
      </section>
      <FinalCta />
    </main>
    <footer className="landing-footer"><ScrollReveal><Logo /><span>Clear evidence. Fairer conversations. Better hiring.</span><span>© {new Date().getFullYear()} FutureFit</span></ScrollReveal></footer>
  </div>;
}

function PageFrame({ children, dashboard = false }: { children: ReactNode; dashboard?: boolean }) {
  return <div className="app-shell min-h-screen"><TopNav dashboard={dashboard} />{children}</div>;
}

function AssessmentHub() {
  const tracks: {
    slug: AssessmentTrack | "full";
    title: string;
    description: string;
    time: string;
    difficulty: string;
    icon: LucideIcon;
  }[] = [
    {
      slug: "problem-solver",
      title: "Problem Solver",
      description: "Debug a messy mini-project, explain hidden bugs, and work through failing checks.",
      time: "15–20 min",
      difficulty: "Intermediate",
      icon: FileCode2,
    },
    {
      slug: "skill",
      title: "Skill",
      description: "Build a practical task in your chosen domain, then defend your approach in an AI viva.",
      time: "20–25 min",
      difficulty: "Intermediate",
      icon: Code2,
    },
    {
      slug: "adapt",
      title: "Adapt",
      description: "Handle a changing requirement, verify AI suggestions, and improve your result.",
      time: "15–20 min",
      difficulty: "Advanced",
      icon: WandSparkles,
    },
    {
      slug: "full",
      title: "Full assessment",
      description: "Complete Problem Solver, Skill, and Adapt in sequence.",
      time: "50–65 min",
      difficulty: "Mixed",
      icon: ClipboardCheck,
    },
  ];

  return <PageFrame><main className="mx-auto max-w-[1120px] px-5 py-10 sm:py-14">
    <div className="max-w-[680px]">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#7b927f]">Choose your assessment</p>
      <h1 className="app-page-title mt-3 text-[32px] font-semibold tracking-[-.05em] sm:text-[40px]">Show how you work.</h1>
      <p className="mt-2 text-[13px] leading-6 text-[#748078]">Pick a focused track or complete the full assessment. Recording starts only after you review and accept the consent screen.</p>
    </div>
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      {tracks.map(({ slug, title, description, time, difficulty, icon: Icon }) => <article key={slug} className="flex min-h-[260px] flex-col rounded-[22px] border border-[#e5ebe6] bg-white p-6 shadow-[0_12px_42px_#17321b08] sm:p-7">
        <div className="grid size-12 place-items-center rounded-2xl bg-[#edf5ef] text-[#4c805b]"><Icon size={22} /></div>
        <h2 className="mt-5 text-[20px] font-semibold tracking-[-.03em] text-[#28392e]">{title}</h2>
        <p className="mt-2 min-h-[40px] text-[12px] leading-5 text-[#77847c]">{description}</p>
        <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-medium text-[#68766d]">
          <span className="rounded-full bg-[#f3f6f3] px-3 py-1.5">Time · {time}</span>
          <span className="rounded-full bg-[#f3f6f3] px-3 py-1.5">Difficulty · {difficulty}</span>
        </div>
        <Link to={`/assessments/${slug}`} state={slug === "full" ? undefined : { freshAssessment: true }} className="primary-glow mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white transition hover:bg-[#28523d]">
          Start <ArrowRight size={14} />
        </Link>
      </article>)}
    </div>
  </main></PageFrame>;
}

function Pill({ children, tone = "gray", verified = false }: { children: React.ReactNode; tone?: "green" | "amber" | "red" | "gray"; verified?: boolean }) {
  const styles = { green: "bg-[#eaf5ed] text-[#39734d]", amber: "bg-[#fff4df] text-[#9b6b22]", red: "bg-[#fceceb] text-[#a34c47]", gray: "bg-[#eef1ef] text-[#68756d]" };
  return <span className={`ui-pill${verified ? " ui-pill-verified" : ""} inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[tone]}`}>{children}</span>;
}

function ConsentStart({ onStart, children }: { onStart: (name: string, email: string, extraTime: boolean) => Promise<void>; children?: ReactNode }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [extraTime, setExtraTime] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setStarting(true);
    setError("");
    try { await onStart(name.trim(), email.trim(), extraTime); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not start your assessment."); }
    finally { setStarting(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#14221bcc] p-4 backdrop-blur-sm">
    <div className="animate-rise my-auto max-h-[calc(100vh-2rem)] w-full max-w-[495px] overflow-y-auto rounded-[24px] border border-white/80 bg-[#fbfcfa] p-5 shadow-2xl sm:p-6">
      <div className="flex items-center justify-between"><Logo /><span className="rounded-full bg-[#eef4ef] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#5c8067]">Before you begin</span></div>
      <div className="mt-5 grid size-11 place-items-center rounded-2xl bg-[#eaf4ed] text-[#457653]"><Eye size={20} /></div>
      <h2 className="mt-3 text-[23px] font-semibold tracking-[-.04em]">Your work, your control.</h2>
      <p className="mt-1.5 text-[12px] leading-5 text-[#738078]">A limited activity timeline helps reviewers understand your process. Here’s what is and isn’t collected.</p>
      <div className="mt-4 space-y-2.5 rounded-2xl border border-[#e7ece8] bg-white p-3.5">
        {[["Collected", "Keypress counts, edits, pastes, time, tab switches, and prompts and responses from the optional assistant."], ["Not collected", "No camera, microphone, screen capture, browsing history, or activity outside this task."], ["Your choice", "Recording starts only after consent. AI use alone is never proof of misconduct."], ["Retention", "Assessment records stay in local SQLite until cleared. Set DATA_RETENTION_DAYS on the API for automatic deletion; demo profiles are preserved."]].map(([title, detail]) => <div key={title} className="flex gap-3"><span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-[#edf5ef] text-[#51805f]"><Check size={12} /></span><p className="text-[10px] leading-[1.55] text-[#78847c]"><strong className="mr-1 font-semibold text-[#33483a]">{title}.</strong>{detail}</p></div>)}
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl p-1 text-[11px] leading-5 text-[#57655d]"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-[#2d6340]" /> I understand what is recorded and agree to share this process evidence with the hiring team.</label>
      <label className="mt-3 block text-[11px] font-semibold text-[#57655d]">Your name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Maya Chen" className="mt-1.5 w-full rounded-xl border border-[#e2e8e3] bg-white px-3.5 py-3 text-[13px] font-normal outline-none transition focus:border-[#81af8c] focus:ring-4 focus:ring-[#e5f1e8]" />
      </label>
      <label className="mt-2 block text-[11px] font-semibold text-[#57655d]">Email <span className="font-normal text-[#9aa49c]">(optional)</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="mt-1.5 w-full rounded-xl border border-[#e2e8e3] bg-white px-3.5 py-3 text-[13px] font-normal outline-none transition focus:border-[#81af8c] focus:ring-4 focus:ring-[#e5f1e8]" />
      </label>
      {children}
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-[#67756c]"><input type="checkbox" checked={extraTime} onChange={(event) => setExtraTime(event.target.checked)} className="mt-0.5 accent-[#477e55]" />Accessibility option: add five minutes to the assessment timer.</label>
      {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff4f2] px-3 py-2 text-[11px] text-[#a34c47]">{error}</p>}
      <button disabled={!consent || !name.trim() || starting} onClick={start} className="primary-glow mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[12px] font-semibold text-white transition hover:bg-[#28523d] disabled:cursor-not-allowed disabled:bg-[#aab8ad]">{starting ? "Preparing your task…" : "I consent and start"} {!starting && <ArrowRight size={15} />}</button>
      <p className="mt-2 text-center text-[9px] text-[#9aa49d]">You can leave at any time. Evidence is used for this assessment only.</p>
    </div>
  </div>;
}

function isAssessmentTrack(track: string | undefined): track is AssessmentTrack {
  return track === "problem-solver" || track === "skill" || track === "adapt";
}

function FullAssessmentRoute() {
  const flow = useAssessmentFlow();
  const navigate = useNavigate();
  useEffect(() => {
    flow.startFull();
    navigate("/assessments/problem-solver", { replace: true, state: { fullSequence: true } });
  }, [flow.startFull, navigate]);
  return <PageFrame><main className="mx-auto max-w-3xl px-5 py-20 text-sm text-[#849087]">Preparing your full assessment…</main></PageFrame>;
}

function evidenceScore(evidence: Record<string, unknown>, key: string) {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function FullAssessmentReport() {
  const { id = "" } = useParams();
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.journey>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.journey(id).then((value) => { if (active) setReport(value); })
      .catch((issue) => { if (active) setError(issue instanceof Error ? issue.message : "Could not load the full assessment report."); });
    return () => { active = false; };
  }, [id]);

  if (error) return <PageFrame><main className="mx-auto max-w-3xl px-5 py-16"><p role="alert" className="rounded-xl bg-[#fff5f3] p-4 text-sm text-[#a34c47]">{error}</p></main></PageFrame>;
  if (!report) return <PageFrame><main className="mx-auto max-w-3xl px-5 py-16 text-sm text-[#849087]">Loading your full assessment report…</main></PageFrame>;

  const resultByTrack = new Map(report.results.map((result) => [result.track, result]));
  const strengths = report.results.filter((result) => result.score >= 70);
  const improvements = report.results.filter((result) => result.score < 70);
  const performanceFeedback = report.combined_score >= 85
    ? "Your results show consistent evidence across the three assessment sections. Keep extending that performance to new tasks and scenarios."
    : report.combined_score >= 70
      ? "Your results show a solid overall foundation, with a few section-specific opportunities to strengthen consistency."
      : "Your results identify clear areas to practice. Use the section feedback and recommendations to target the next improvement.";
  const learningRecommendations: Partial<Record<AssessmentTrack, string>> = {
    "problem-solver": "Practice explaining root causes before changing code, then verify each fix with a focused test.",
    skill: "Review the viva explanations and strengthen the practical task's edge-case handling and verification.",
    adapt: "Revisit the scenario feedback and practice mapping task changes to an inclusive, evidence-led response.",
  };

  return <PageFrame><main className="mx-auto max-w-[850px] px-5 py-12 sm:py-16">
    <div className="rounded-[24px] border border-[#e5ebe6] bg-white p-7 shadow-[0_12px_50px_#17321b0a] sm:p-10">
      <div className="text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#eaf5ed] text-[#4c805a]"><CheckCircle2 size={24} /></span>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.15em] text-[#7b927f]">Full assessment complete</p>
        <h1 className="app-page-title mt-2 text-[30px] font-semibold tracking-[-.05em]">Your performance report</h1>
        <p className="mt-2 text-[12px] text-[#738078]">{report.candidate_name} · Problem Solver, Skill, and Adapt</p>
        <div className="mt-5 text-[58px] font-semibold tracking-[-.07em] text-[#315d3e]">{report.combined_score}<span className="text-[18px] text-[#91a196]">/100</span></div>
        <p className="text-[10px] text-[#89958d]">Combined score calculated using the configured track weights.</p>
        <p className="mx-auto mt-3 max-w-[560px] rounded-xl bg-[#f7faf7] px-4 py-3 text-[10px] leading-5 text-[#6f7d73]"><strong className="text-[#435349]">Performance feedback:</strong> {performanceFeedback}</p>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {(["problem-solver", "skill", "adapt"] as const).map((track) => {
          const result = resultByTrack.get(track);
          const practical = evidenceScore(result?.evidence || {}, track === "skill" ? "skill_practical_score" : "adapt_practical_score");
          const viva = evidenceScore(result?.evidence || {}, track === "skill" ? "skill_viva_score" : "adapt_scenario_score");
          return <div key={track} className="rounded-2xl border border-[#e5ebe6] bg-[#fafcfb] p-4">
            <h2 className="text-[11px] font-semibold text-[#47584d]">{trackLabels[track]}</h2>
            <div className="mt-2 text-[30px] font-semibold tracking-[-.05em] text-[#315d3e]">{result?.score ?? "—"}<span className="ml-1 text-[12px] text-[#91a196]">/100</span></div>
            {track !== "problem-solver" && <div className="mt-2 space-y-1 text-[9px] text-[#7f8c83]">
              <p>{track === "skill" ? "Practical task" : "Adaptation checks"}: {practical === null ? "—" : `${practical}/100`}</p>
              <p>{track === "skill" ? "MCQ viva" : "Workplace scenarios"}: {viva === null ? "—" : `${viva}/100`}</p>
            </div>}
          </div>;
        })}
      </div>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-[#e5ebe6] p-4"><h2 className="text-[11px] font-semibold text-[#435349]">Strengths</h2>
          {strengths.length ? <ul className="mt-2 space-y-2 text-[10px] leading-5 text-[#6f7d73]">{strengths.map((result) => <li key={result.track}><strong className="text-[#4c805a]">{trackLabels[result.track] || result.track} ({result.score}/100):</strong> {result.score >= 85 ? "Strong evidence across this section." : "A solid result with room to deepen consistency."}</li>)}</ul> : <p className="mt-2 text-[10px] leading-5 text-[#89958d]">No section reached the current 70/100 strength marker; use the feedback and recommendations below to guide practice.</p>}
        </section>
        <section className="rounded-2xl border border-[#e5ebe6] p-4"><h2 className="text-[11px] font-semibold text-[#435349]">Areas to improve</h2>
          {improvements.length ? <ul className="mt-2 space-y-2 text-[10px] leading-5 text-[#6f7d73]">{improvements.map((result) => <li key={result.track}><strong className="text-[#9b6b22]">{trackLabels[result.track] || result.track} ({result.score}/100):</strong> {learningRecommendations[result.track as AssessmentTrack]}</li>)}</ul> : <p className="mt-2 text-[10px] leading-5 text-[#89958d]">All sections reached the current 70/100 strength marker. Continue practicing with varied tasks and scenarios.</p>}
        </section>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/assessments" className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white hover:bg-[#28523d]">Back to assessments <ArrowRight size={14} /></Link>
        <Link to="/hr" className="inline-flex items-center gap-2 rounded-full border border-[#dfe8e1] px-5 py-3 text-[11px] font-semibold text-[#4a7257] hover:bg-[#f3faf4]">View hiring dashboard <ArrowRight size={14} /></Link></div>
    </div>
  </main></PageFrame>;
}

function AssessmentTrackRoute() {
  const { track: routeTrack } = useParams();
  const location = useLocation();
  const flow = useAssessmentFlow();
  const freshStartHandled = useRef(false);
  const validTrack = isAssessmentTrack(routeTrack);
  const track = validTrack ? routeTrack : null;
  const isCurrentJourneyStep = Boolean(track && flow.journey.active &&
    flow.journey.tracks[flow.journey.currentIndex] === track);

  useEffect(() => {
    if (!track) return;
    if (location.state?.freshAssessment) {
      if (freshStartHandled.current) return;
      freshStartHandled.current = true;
      flow.startSingle(track);
      return;
    }
    if (!isCurrentJourneyStep) flow.startSingle(track);
  }, [flow.startSingle, isCurrentJourneyStep, location.state, track]);

  if (!track) return <Navigate to="/assessments" replace />;
  return <Assessment key={track} track={track} />;
}

function TrackResultScreen() {
  const { id = "" } = useParams();
  const flow = useAssessmentFlow();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.candidate(id).then(setCandidate)
      .catch((issue) => setError(issue instanceof Error ? issue.message : "Could not load assessment results."));
  }, [id]);

  if (error) return <PageFrame><main className="mx-auto max-w-2xl px-5 py-16"><p role="alert" className="rounded-xl bg-[#fff5f3] p-4 text-sm text-[#a34c47]">{error}</p></main></PageFrame>;
  if (!candidate) return <PageFrame><main className="mx-auto max-w-2xl px-5 py-16 text-sm text-[#849087]">Loading your result…</main></PageFrame>;

  const track = isAssessmentTrack(candidate.track) ? candidate.track : "skill";
  const result = candidate.track_results?.find((item) => item.track === track);
  const nextTrack = flow.journey.tracks[flow.journey.currentIndex + 1];
  const continueJourney = () => {
    if (!result) return;
    const next = flow.advance(track, result.score);
    if (next) navigate(`/assessments/${next}`, { state: { fullSequence: true } });
    else if (flow.journey.tracks.length > 1 && flow.journey.journeyId) {
      navigate(`/assessments/full/results/${flow.journey.journeyId}`);
    } else navigate("/assessments");
  };
  const practicalKey = track === "skill" ? "skill_practical_score" : "adapt_practical_score";
  const vivaKey = track === "skill" ? "skill_viva_score" : "adapt_scenario_score";
  const practicalScore = result ? evidenceScore(result.evidence, practicalKey) : null;
  const vivaScore = result ? evidenceScore(result.evidence, vivaKey) : null;
  const signalLabels: Record<string, string> = {
    viva: track === "adapt" ? "Workplace scenario decisions" : "Viva answers",
    process: "Work process and iteration",
    aiUsage: "Evaluation of AI assistance",
    liveCheck: track === "adapt" ? "Practical adaptation checks" : "Practical task checks",
    timeAndPaste: "Time and work evidence",
  };
  const strengths = result ? Object.entries(result.signals).filter(([, score]) => score >= 70) : [];
  const gaps = result ? Object.entries(result.signals).filter(([, score]) => score < 70) : [];
  const performanceFeedback = result?.score !== undefined
    ? result.score >= 85
      ? "Strong evidence across this section; continue applying the same care to new tasks."
      : result.score >= 70
        ? "A solid result, with opportunities to make the evidence more consistent."
        : "The evidence points to specific skills worth practicing before the next assessment."
    : "The result is still being prepared.";
  const recommendations: Record<string, string> = {
    viva: track === "adapt" ? "Review the scenario explanations and practice comparing options against evidence and inclusion." : "Review the explanations for missed questions and practice explaining the task's key edge cases.",
    liveCheck: "Revisit the practical requirements, make a targeted improvement, and verify it with focused checks.",
    process: "Use smaller iterations and record what each verification step confirms.",
    aiUsage: "When using assistance, verify suggestions against the task and trusted sources before applying them.",
    timeAndPaste: "Allow time for independent review and a final edge-case check.",
  };

  return <PageFrame><main className="mx-auto max-w-[760px] px-5 py-12 sm:py-16">
    <div className="rounded-[24px] border border-[#e5ebe6] bg-white p-7 text-center shadow-[0_12px_50px_#17321b0a] sm:p-10">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#eaf5ed] text-[#4c805a]"><CheckCircle2 size={24} /></span>
      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.15em] text-[#7b927f]">{nextTrack ? "Track complete" : "Assessment complete"}</p>
      <h1 className="app-page-title mt-2 text-[30px] font-semibold tracking-[-.05em]">{track === "problem-solver" ? "Problem Solver" : track === "adapt" ? "Adapt" : "Skill"} result</h1>
      {result ? <><div className="mt-5 text-[54px] font-semibold tracking-[-.07em] text-[#315d3e]">{result.score}<span className="text-[18px] text-[#91a196]">/100</span></div><p className="mt-2 text-[12px] text-[#738078]">{result.domain} · Your evidence has been saved.</p></> : <p className="mt-4 text-[12px] text-[#738078]">Your result is being prepared. Refresh this page if it does not appear.</p>}
      {result && <p className="mx-auto mt-3 max-w-[560px] rounded-xl bg-[#f7faf7] px-4 py-3 text-left text-[10px] leading-5 text-[#6f7d73]"><strong className="text-[#435349]">Performance feedback:</strong> {performanceFeedback}</p>}
      {result && track !== "problem-solver" && <div className="mx-auto mt-6 grid max-w-[540px] gap-3 text-left sm:grid-cols-2">
        <div className="rounded-xl border border-[#e7ece8] bg-[#fafcfb] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8c9990]">{track === "skill" ? "Practical task score" : "Adaptation checks"}</div><div className="mt-1 text-[22px] font-semibold text-[#315d3e]">{practicalScore ?? "—"}<span className="ml-1 text-[10px] text-[#91a196]">/100</span></div></div>
        <div className="rounded-xl border border-[#e7ece8] bg-[#fafcfb] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8c9990]">{track === "skill" ? "MCQ viva score" : "Workplace scenario score"}</div><div className="mt-1 text-[22px] font-semibold text-[#315d3e]">{vivaScore ?? "—"}<span className="ml-1 text-[10px] text-[#91a196]">/100</span></div></div>
      </div>}
      {result && <div className="mx-auto mt-6 grid max-w-[650px] gap-3 text-left sm:grid-cols-2">
        <section className="rounded-xl border border-[#e7ece8] p-4"><h2 className="text-[10px] font-semibold text-[#435349]">Strengths</h2>
          {strengths.length ? <ul className="mt-2 space-y-1.5 text-[9px] leading-4 text-[#77847c]">{strengths.map(([key, score]) => <li key={key}><strong className="text-[#4c805a]">{signalLabels[key] || key} ({score}/100).</strong> Evidence is at or above the current 70/100 strength marker.</li>)}</ul> : <p className="mt-2 text-[9px] leading-4 text-[#89958d]">Use the learning actions below to build stronger evidence in this section.</p>}
        </section>
        <section className="rounded-xl border border-[#e7ece8] p-4"><h2 className="text-[10px] font-semibold text-[#435349]">Areas to improve</h2>
          {gaps.length ? <ul className="mt-2 space-y-1.5 text-[9px] leading-4 text-[#77847c]">{gaps.map(([key, score]) => <li key={key}><strong className="text-[#9b6b22]">{signalLabels[key] || key} ({score}/100):</strong> {recommendations[key] || "Review the related task evidence and practice a focused improvement."}</li>)}</ul> : <p className="mt-2 text-[9px] leading-4 text-[#89958d]">No section signal is below the current 70/100 practice marker.</p>}
        </section>
      </div>}
      {track === "skill" && candidate.viva.length > 0 && <div className="mt-7 space-y-2 text-left">
        <h2 className="text-[11px] font-semibold text-[#56645b]">AI viva · scored answers</h2>
        {candidate.viva.map((answer, index) => <div key={`${answer.question}-${index}`} className="rounded-xl border border-[#e7ece8] bg-[#fafcfb] px-4 py-3">
          <div className="flex items-start justify-between gap-3"><p className="text-[10px] font-medium leading-5 text-[#59685e]">{answer.question}</p><span className="shrink-0 rounded-full bg-[#edf5ef] px-2.5 py-1 text-[9px] font-semibold text-[#4c805a]">{answer.score === null ? "—" : `${(answer.score / 10).toFixed(1)}/10`}</span></div>
          {answer.feedback && <p className="mt-1 text-[9px] leading-4 text-[#89958d]">{answer.feedback}</p>}
        </div>)}
      </div>}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {nextTrack && <button disabled={!result} onClick={continueJourney} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]">Continue to next track <ArrowRight size={14} /></button>}
        <Link to={`/candidates/${candidate.id}`} className="inline-flex items-center gap-2 rounded-full border border-[#dfe8e1] px-5 py-3 text-[11px] font-semibold text-[#4a7257] hover:bg-[#f3faf4]">View evidence report <ArrowRight size={14} /></Link>
        {!nextTrack && flow.journey.tracks.length > 1 && flow.journey.journeyId && result && <button onClick={continueJourney} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white hover:bg-[#28523d]">View full report <ArrowRight size={14} /></button>}
        {!nextTrack && (flow.journey.tracks.length <= 1 || !flow.journey.journeyId) && <Link to="/assessments" className="inline-flex items-center gap-2 rounded-full border border-[#dfe8e1] px-5 py-3 text-[11px] font-semibold text-[#4a7257] hover:bg-[#f3faf4]">Back to assessments <ArrowRight size={14} /></Link>}
      </div>
    </div>
  </main></PageFrame>;
}

function Assessment({ track }: { track: AssessmentTrack }) {
  const flow = useAssessmentFlow();
  const navigate = useNavigate();
  const [trackCatalog, setTrackCatalog] = useState<TracksCatalog | null>(null);
  const [domain, setDomain] = useState(defaultTrackDomain[track]);
  const [skillDomainReady, setSkillDomainReady] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [consent, setConsent] = useState(false);
  const [extraTime, setExtraTime] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(starterCode);
  const [taskVariant, setTaskVariant] = useState<TaskVariant | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [prompts, setPrompts] = useState<Candidate["ai_prompts"]>([]);
  const [bugNotes, setBugNotes] = useState("");
  const [whyNotes, setWhyNotes] = useState("");
  const [testRuns, setTestRuns] = useState(0);
  const [testResults, setTestResults] = useState<boolean[] | null>(null);
  const [firstFixSeconds, setFirstFixSeconds] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(20 * 60);
  const [requirementUpdate, setRequirementUpdate] = useState("");
  const [keypressCount, setKeypressCount] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [autoStartError, setAutoStartError] = useState("");
  const [autoStarting, setAutoStarting] = useState(false);
  const startAt = useRef(0);
  const codeRef = useRef(code);
  const eventCount = useRef(0);
  const keypresses = useRef(0);
  const recordingEnabled = useRef(false);
  const eventQueue = useRef<TimelineEvent[]>([]);
  const flushInProgress = useRef(false);
  const lastActivity = useRef(Date.now());
  const idleStarted = useRef(0);
  const assistantCodeSnapshots = useRef(new Map<string, string>());
  const trackDefinition: TrackDefinition | undefined = trackCatalog?.tracks[track];
  const availableDomains = trackDefinition?.domains || [];
  const domainDefinition = trackCatalog?.domains[domain];
  const practicalTask = domainDefinition?.kind === "practical";
  const skillDomainGate = track === "skill" && flow.journey.tracks.length > 1 && Boolean(flow.journey.profile);

  useEffect(() => {
    let active = true;
    api.tracks().then((catalog) => {
      if (!active) return;
      setTrackCatalog(catalog);
      if (!catalog.tracks[track].domains.includes(domain)) setDomain(catalog.tracks[track].domains[0]);
    }).catch((issue) => {
      if (active) setError(issue instanceof Error ? issue.message : "Could not load assessment tracks.");
    });
    return () => { active = false; };
  }, [track]);

  const stamp = useCallback(() => {
    const seconds = Math.floor((Date.now() - startAt.current) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, []);
  const pushEvent = useCallback((event: Pick<TimelineEvent, "type" | "detail"> & Partial<Pick<TimelineEvent, "count" | "characters">>) => {
    const timestamp = new Date().toISOString();
    const item: TimelineEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp,
      time: stamp(),
      count: event.count ?? 1,
    };
    eventQueue.current.push(item);
    setEvents((current) => [...current, item]);
  }, [stamp]);

  const flushEvents = useCallback(async () => {
    if (!sessionId || !eventQueue.current.length) return !flushInProgress.current;
    if (flushInProgress.current) return false;
    flushInProgress.current = true;
    const batch = eventQueue.current.splice(0, 100);
    try {
      await api.sessionEvents(sessionId, batch);
      return true;
    } catch (issue) {
      eventQueue.current.unshift(...batch);
      setError(issue instanceof Error ? issue.message : "Could not save your activity timeline.");
      return false;
    } finally {
      flushInProgress.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!consent || !sessionId) return;
    const started = Date.now();
    startAt.current = started;
    recordingEnabled.current = true;
    lastActivity.current = started;
    const assessmentLimit = 20 * 60 + (extraTime ? 300 : 0);
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      setTimeRemaining(Math.max(0, assessmentLimit - seconds));
    }, 1000);
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        pushEvent({ type: "tab", detail: "Assessment tab lost focus" });
      }
    };
    const blur = () => pushEvent({ type: "blur", detail: "Assessment window lost focus" });
    const activity = () => {
      if (idleStarted.current) {
        const idleSeconds = Math.max(1, Math.round((Date.now() - idleStarted.current) / 1000));
        pushEvent({ type: "idle", detail: `Returned after ${idleSeconds} seconds without activity`, count: idleSeconds });
        idleStarted.current = 0;
      }
      lastActivity.current = Date.now();
    };
    const idleTimer = window.setInterval(() => {
      if (!idleStarted.current && Date.now() - lastActivity.current >= 30000) idleStarted.current = lastActivity.current;
    }, 5000);
    const batchTimer = window.setInterval(() => { void flushEvents(); }, 4000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      recordingEnabled.current = false;
      window.clearInterval(timer);
      window.clearInterval(idleTimer);
      window.clearInterval(batchTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      void flushEvents();
    };
  }, [consent, extraTime, flushEvents, pushEvent, sessionId]);

  useEffect(() => {
    if (!sessionId || !consent || track !== "adapt" || requirementUpdate) return;
    let active = true;
    const check = async () => {
      try {
        const result = await api.requirementChange(sessionId);
        if (!active || !result.fired || requirementUpdate) return;
        setRequirementUpdate(result.message || "Also handle records with missing values for the selected field.");
        await api.acknowledgeRequirementChange(sessionId);
      } catch (issue) {
        if (active) setError(issue instanceof Error ? issue.message : "Could not check for task updates.");
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [consent, requirementUpdate, sessionId, track]);

  const onEditorMount = (editor: Parameters<NonNullable<ComponentProps<typeof Editor>["onMount"]>>[0]) => {
    editor.onDidChangeModelContent((change) => {
      if (!recordingEnabled.current) return;
      const count = Math.max(1, change.changes.length);
      const characters = change.changes.reduce((sum, item) => sum + item.text.length, 0);
      eventCount.current += count;
      pushEvent({ type: "edit", detail: "Edited solution in code editor", count, characters });
    });
    const element = editor.getDomNode();
    element?.addEventListener("paste", (event) => {
      if (!recordingEnabled.current) return;
      const pasted = (event as ClipboardEvent).clipboardData?.getData("text") || "";
      const count = pasted ? pasted.split("\n").length : 1;
      pushEvent({ type: "paste", detail: `Pasted ${pasted.length} characters into editor`, count, characters: pasted.length });
    }, true);
    editor.onKeyDown((event) => {
      if (!recordingEnabled.current || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.browserEvent.key)) return;
      keypresses.current += 1;
      setKeypressCount(keypresses.current);
    });
  };
  async function askAssistant(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !sessionId) return;
    const value = prompt.trim();
    setPrompt("");
    setAssistantBusy(true);
    setError("");
    try {
      const result = await api.sessionAssistant(sessionId, value);
      assistantCodeSnapshots.current.set(result.prompt.id, codeRef.current);
      setPrompts((current) => [...current, {
        id: result.prompt.id,
        prompt: value,
        response: result.answer,
        verified: false,
        caught: false,
        edited_after: false,
        summary: summarizePrompt(value),
      }]);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Assistant unavailable."); }
    finally { setAssistantBusy(false); }
  }
  async function markSuggestion(item: Candidate["ai_prompts"][number], kind: "tested" | "caught", checked: boolean) {
    if (!sessionId || !item.id) return;
    const verified = kind === "tested" ? checked || Boolean(item.caught) : checked || item.verified;
    const caught = kind === "caught" ? checked : item.caught;
    try {
      await api.verifyPrompt(sessionId, item.id, { verified, caught });
      setPrompts((current) => current.map((promptItem) => promptItem.id === item.id ? {
        ...promptItem,
        verified,
        caught,
        summary: caught ? "Candidate reported finding a potential error in the suggestion."
          : verified ? "Candidate reported testing the suggestion." : "Candidate has not reported testing the suggestion.",
      } : promptItem));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save your verification."); }
  }
  function changeWork(value: string, recordEvent = true) {
    codeRef.current = value;
    setCode(value);
    if (recordEvent && recordingEnabled.current) pushEvent({ type: "edit", detail: "Edited assessment work", count: 1, characters: value.length });
    if (track !== "adapt") return;
    const changedPrompts = prompts.filter((item) => item.id && !item.edited_after &&
      assistantCodeSnapshots.current.get(item.id) !== value);
    if (!changedPrompts.length) return;
    setPrompts((current) => current.map((item) => changedPrompts.some((changed) => changed.id === item.id)
      ? { ...item, edited_after: true } : item));
    changedPrompts.forEach((item) => {
      if (!item.id) return;
      void api.verifyPrompt(sessionId, item.id, {
        verified: item.verified,
        ...(typeof item.caught === "boolean" ? { caught: item.caught } : {}),
        edited_after: true,
      }).catch((issue) => setError(issue instanceof Error ? issue.message : "Could not save your edit evidence."));
    });
  }
  function runChecks() {
    if (!recordingEnabled.current) return;
    const results = checksForWork(track, domain, codeRef.current, taskVariant, Boolean(requirementUpdate));
    const nextRuns = testRuns + 1;
    setTestRuns(nextRuns);
    setTestResults(results);
    pushEvent({ type: "run", detail: `Ran ${track === "problem-solver" ? "failing tests" : track === "adapt" ? "verification checks" : "build checks"}`, count: nextRuns });
    if (track === "problem-solver" && firstFixSeconds === null && results.some(Boolean)) setFirstFixSeconds(elapsed);
  }
  async function submit() {
    if (!sessionId) return;
    setSubmitting(true);
    setError("");
    try {
      const flushed = await flushEvents();
      if (!flushed || eventQueue.current.length) throw new Error("Your activity timeline could not be saved. Please try submitting again.");
      const saved = await api.submitAssessment({ name, email, code: codeRef.current, consent: true, session_id: sessionId, events, ai_prompts: prompts, duration_seconds: elapsed, keystrokes: keypresses.current });
      if (track === "skill" || track === "adapt") {
        await api.questions(saved.id, { track, task: taskVariant?.description || codeRef.current });
        navigate(`/viva/${saved.id}`);
      } else {
        const testScore = testResults?.length
          ? Math.round(testResults.filter(Boolean).length / testResults.length * 100)
          : 0;
        const signals = trackSignals(saved.candidate, testScore, `${bugNotes}\n${whyNotes}`);
        const evidence = {
          bug_notes: bugNotes,
          explanation: whyNotes,
          test_runs: testRuns,
          tests: testResults,
          time_to_first_fix_seconds: firstFixSeconds,
          requirement_change_seen: Boolean(requirementUpdate),
          prompts: prompts.map(({ prompt: question, verified, caught, edited_after }) => ({ prompt: question, verified, caught, edited_after })),
        };
        await api.submitTrackResult(sessionId, {
          track,
          domain,
          task_variant: taskVariant?.id || "",
          signals,
          evidence,
        });
        navigate(`/assessments/result/${saved.id}`);
      }
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not submit assessment."); }
    finally { setSubmitting(false); }
  }
  const startSession = useCallback(async (candidateName: string, candidateEmail: string, extraTime: boolean) => {
    const session = await api.startTrackSession(candidateName, candidateEmail, extraTime, track, domain, flow.journey.journeyId);
    setError("");
    flow.rememberProfile({ name: candidateName, email: candidateEmail, extraTime });
    setName(candidateName);
    setEmail(candidateEmail);
    setExtraTime(extraTime);
    setSessionId(session.session_id);
    setTaskVariant(session.task_variant);
    setCode(starterForTask(session.task_variant, domain));
    codeRef.current = starterForTask(session.task_variant, domain);
    setTimeRemaining(20 * 60 + (extraTime ? 300 : 0));
    setConsent(true);
  }, [domain, flow.rememberProfile, track]);
  const autoStartInProgress = useRef(false);
  const autoStartNextTrack = useCallback(async (profile: AssessmentProfile) => {
    if (autoStartInProgress.current) return;
    autoStartInProgress.current = true;
    setAutoStarting(true);
    setAutoStartError("");
    try {
      await startSession(profile.name, profile.email, profile.extraTime);
    } catch (issue) {
      setAutoStartError(issue instanceof Error ? issue.message : "Could not start the next assessment.");
    } finally {
      autoStartInProgress.current = false;
      setAutoStarting(false);
    }
  }, [startSession]);
  useEffect(() => {
    const profile = flow.journey.profile;
    if (!profile || !flow.journey.active || flow.journey.tracks[flow.journey.currentIndex] !== track ||
        sessionId || skillDomainGate && !skillDomainReady) return;
    void autoStartNextTrack(profile);
  }, [autoStartNextTrack, flow.journey, sessionId, skillDomainGate, skillDomainReady, track]);
  const time = `${String(Math.floor(timeRemaining / 60)).padStart(2, "0")}:${String(timeRemaining % 60).padStart(2, "0")}`;
  const taskTitle = taskVariant?.title || trackDefinition?.tasks.find((task) => task.domain === domain)?.title || "Your task";
  const checkLabels = track === "problem-solver"
    ? taskVariant?.failingTests || ["Task-specific behavior", "Edge-case handling"]
    : track === "adapt"
      ? ["The task has a clear outcome", "Work reflects the updated requirement", "The output has been verified"]
      : ["A solution is present", "The task requirements are addressed", "An edge case or verification is included"];
  const shownTestResults = testResults || (track === "problem-solver" ? checkLabels.map(() => false) : null);
  const canSubmit = Boolean(code.trim()) && (track !== "problem-solver" || Boolean(bugNotes.trim() && whyNotes.trim()));
  const domainPicker = track === "skill" ? <label className="mt-3 block text-left text-[11px] font-semibold text-[#57655d]">Assessment domain
    <select value={domain} onChange={(event) => setDomain(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e8e3] bg-white px-3.5 py-3 text-[13px] font-normal outline-none transition focus:border-[#81af8c] focus:ring-4 focus:ring-[#e5f1e8]">
      {availableDomains.map((domainId) => <option key={domainId} value={domainId}>{trackCatalog?.domains[domainId]?.title || domainId}</option>)}
    </select>
    {!availableDomains.length && <span className="mt-1 block text-[10px] font-normal text-[#9aa49c]">Loading available domains…</span>}
  </label> : null;

  return <PageFrame>
    {!consent && !flow.journey.profile && <ConsentStart onStart={startSession}>{domainPicker}</ConsentStart>}
    {!consent && flow.journey.profile && (!skillDomainGate || skillDomainReady) && (autoStarting || autoStartError) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14221bcc] p-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-[24px] border border-white/80 bg-[#fbfcfa] p-6 text-center shadow-2xl">
        <p className="text-sm font-semibold text-[#33483a]">{autoStarting ? "Preparing the next assessment…" : "The next assessment could not start."}</p>
        {autoStartError && <p role="alert" className="mt-3 rounded-xl bg-[#fff4f2] px-3 py-2 text-[11px] text-[#a34c47]">{autoStartError}</p>}
        {!autoStarting && <button onClick={() => void autoStartNextTrack(flow.journey.profile!)} className="primary-glow mt-4 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white">Retry</button>}
      </div>
    </div>}
    {!consent && skillDomainGate && !skillDomainReady && <main className="mx-auto max-w-[760px] px-5 py-12 sm:py-16">
      <div className="rounded-[24px] border border-[#e5ebe6] bg-white p-7 shadow-[0_12px_50px_#17321b0a] sm:p-9">
        <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#7b927f]">Full assessment · Track 2 of 3</p>
        <h1 className="app-page-title mt-3 text-[30px] font-semibold tracking-[-.05em]">Choose your Skill domain.</h1>
        <p className="mt-2 text-[12px] leading-5 text-[#748078]">Your consent from the start of this full assessment still applies. Recording begins when you start this task.</p>
        <label className="mt-5 block text-[11px] font-semibold text-[#57655d]">Assessment domain
          <select value={domain} onChange={(event) => setDomain(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e8e3] bg-white px-3.5 py-3 text-[13px] font-normal outline-none transition focus:border-[#81af8c] focus:ring-4 focus:ring-[#e5f1e8]">
            {availableDomains.map((domainId) => <option key={domainId} value={domainId}>{trackCatalog?.domains[domainId]?.title || domainId}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff4f2] px-3 py-2 text-[11px] text-[#a34c47]">{error}</p>}
        <button onClick={() => { setError(""); setSkillDomainReady(true); }} disabled={!availableDomains.includes(domain)} className="primary-glow mt-5 inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[11px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]">Start Skill task <ArrowRight size={14} /></button>
      </div>
    </main>}
    {(!skillDomainGate || skillDomainReady || consent) && <main className="mx-auto max-w-[1370px] px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#87938b]"><Link to="/" className="hover:text-[#395c44]">Home</Link><ChevronRight size={13} /><Link to="/assessments" className="hover:text-[#395c44]">Assessments</Link><ChevronRight size={13} /><span className="font-medium text-[#3d4d43]">{trackDefinition?.title || "Assessment"}</span></div>
        <div className="flex items-center gap-2">
          <span role="status" title={consent ? "Recording process with consent" : "Recording paused"} aria-label={consent ? "Recording process with consent" : "Recording paused"} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${consent ? "bg-[#eaf5ed] text-[#43805a]" : "bg-[#eff2ef] text-[#78857d]"}`}>
            <Radio size={13} /><span className={`size-1.5 rounded-full ${consent ? "animate-pulse bg-[#4eaa6a]" : "bg-[#a6b0a9]"}`} /><span className="hidden sm:inline">{consent ? "Recording" : "Paused"}</span>
          </span>
          {consent && <span role="timer" title={`${time} remaining`} aria-label={`${time} remaining`} className="inline-flex items-center gap-1.5 rounded-full border border-[#e4eae5] bg-white px-3 py-1.5 text-[11px] tabular-nums text-[#65736a]"><Clock3 size={13} />{time}<span className="hidden sm:inline">left</span></span>}
        </div>
      </div>
      {flow.journey.tracks.length > 1 && <section aria-label="Full assessment progress" className="mb-4 rounded-2xl border border-[#e5ebe6] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] font-semibold text-[#7e8b82]"><span>Full assessment · section {flow.journey.currentIndex + 1} of 3</span><span>{trackLabels[track]}</span></div>
        <div className="mt-2 flex gap-2">{flow.journey.tracks.map((journeyTrack, index) => <div key={`${journeyTrack}-${index}`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e6ece7]"><div className={`h-full transition-all ${flow.journey.scores[journeyTrack] !== undefined ? "bg-[#69a579]" : index === flow.journey.currentIndex ? "bg-[#a6c8ad]" : "bg-transparent"}`} style={{ width: flow.journey.scores[journeyTrack] !== undefined ? "100%" : index === flow.journey.currentIndex ? "45%" : "0%" }} /></div>)}</div>
      </section>}
      {requirementUpdate && <div role="status" className="requirement-banner mb-4 rounded-2xl border border-[#f0dfbd] bg-[#fff9eb] px-5 py-3.5 text-[12px] leading-5 text-[#82652e]"><strong>Requirement update:</strong> {requirementUpdate}</div>}
      <div className={`grid items-start gap-4 ${track === "adapt" ? "xl:grid-cols-[270px_minmax(0,1fr)_300px]" : "xl:grid-cols-[270px_minmax(0,1fr)]"}`}>
        <aside className="rounded-[20px] border border-[#e5ebe6] bg-white p-5 shadow-[0_6px_25px_#17321b08]">
          <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#edf5ef] text-[#4c7b5b]"><FileCode2 size={16} /></span><div><h1 className="app-context-title text-[13px] font-semibold">{taskTitle}</h1><Pill tone="gray">{domainDefinition?.title || domain}</Pill></div></div>
          <h2 className="mt-5 text-[10px] font-semibold uppercase tracking-[.11em] text-[#819087]">Task description</h2>
          <p className="mt-2 text-[12px] leading-5 text-[#55645b]">{taskVariant?.description || "Prepare your individualized task."}</p>
          {taskVariant?.dataset && <><h2 className="mt-5 text-[10px] font-semibold uppercase tracking-[.11em] text-[#819087]">Sample records</h2><pre className="mt-2 overflow-auto rounded-xl bg-[#f7faf7] p-3 text-[10px] leading-5 text-[#66756b]">{JSON.stringify(taskVariant.dataset, null, 2)}</pre></>}
          {track === "problem-solver" && <div className="mt-5 space-y-3">
            <label className="block text-[10px] font-semibold text-[#66766c]">Bugs found
              <textarea value={bugNotes} onChange={(event) => setBugNotes(event.target.value)} rows={3} placeholder="List each bug you noticed…" className="mt-2 w-full resize-y rounded-xl border border-[#e3e9e4] bg-[#fafcfb] p-3 text-[11px] leading-5 outline-none focus:border-[#81af8c] focus:ring-4 focus:ring-[#e7f2e9]" />
            </label>
            <label className="block text-[10px] font-semibold text-[#66766c]">What is wrong and why?
              <textarea value={whyNotes} onChange={(event) => setWhyNotes(event.target.value)} rows={4} placeholder="Explain the behavior you found and why it fails…" className="mt-2 w-full resize-y rounded-xl border border-[#e3e9e4] bg-[#fafcfb] p-3 text-[11px] leading-5 outline-none focus:border-[#81af8c] focus:ring-4 focus:ring-[#e7f2e9]" />
            </label>
          </div>}
          {track === "adapt" && <p className="mt-5 rounded-xl border border-[#e8ece8] bg-[#fafcfb] p-3 text-[10px] leading-4 text-[#89958d]">After three minutes, a new requirement appears. Check assistant advice, test your output, and revise it when needed.</p>}
        </aside>
        <section className="overflow-hidden rounded-[20px] border border-[#e5ebe6] bg-white shadow-[0_6px_25px_#17321b08]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ed] px-5 py-4">
            <div><h2 className="text-[13px] font-semibold">{practicalTask ? "Written response" : track === "problem-solver" ? "Broken mini-project" : "Solution editor"}</h2><p className="mt-1 text-[10px] text-[#89958d]">{track === "problem-solver" ? "Find the defects, explain them, and repair the failing checks." : track === "adapt" ? "Start with the task, then respond to the updated requirement." : "Build the task in your selected domain and prepare to explain your choices."}</p></div>
          </div>
          {practicalTask
            ? <textarea aria-label="Assessment written response" value={code} onChange={(event) => changeWork(event.target.value)} onKeyDown={(event) => {
              if (!recordingEnabled.current || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return;
              keypresses.current += 1;
              setKeypressCount(keypresses.current);
            }} rows={18} className="min-h-[430px] w-full resize-y bg-[#111b18] p-5 font-mono text-[12px] leading-6 text-[#c0d0c4] outline-none sm:min-h-[500px]" />
            : <div className="editor-shell h-[430px] overflow-hidden bg-[#111b18] sm:h-[500px]">
              <Editor height="100%" defaultLanguage={domain} theme="vs-dark" value={code} onChange={(value) => changeWork(value || "", false)} onMount={onEditorMount} options={{ minimap: { enabled: false }, fontSize: 13, lineHeight: 23, padding: { top: 18 }, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, automaticLayout: true, renderLineHighlight: "line", guides: { indentation: true }, scrollbar: { verticalScrollbarSize: 7 } }} />
            </div>}
          {(track === "problem-solver" || testResults) && <div className="border-t border-[#edf0ed] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[11px] font-semibold text-[#56645b]">{track === "problem-solver" ? "Failing test suite" : track === "adapt" ? "Verification checks" : "Build checks"}</h3><span className="text-[9px] text-[#98a29b]">{testRuns} run{testRuns === 1 ? "" : "s"}{track === "problem-solver" && firstFixSeconds !== null ? ` · First fix at ${Math.floor(firstFixSeconds / 60)}:${String(firstFixSeconds % 60).padStart(2, "0")}` : ""}</span></div>
            <div className="mt-2 space-y-1.5">{checkLabels.map((label, index) => {
              const passed = shownTestResults?.[index] ?? false;
              return <div key={label} className="flex items-center justify-between rounded-lg bg-[#fafcfb] px-3 py-2 text-[10px]"><span className="text-[#748078]">{label}</span><span className={`font-semibold ${passed ? "text-[#4c805a]" : "text-[#a34c47]"}`}>{passed ? "Passed" : "Failed"}</span></div>;
            })}</div>
            <p className="mt-2 text-[9px] leading-4 text-[#98a29b]">Demo checks use task-specific patterns and do not execute the submitted code.</p>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ed] bg-[#fcfdfb] px-5 py-3">
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#8a968f]"><span className="flex items-center gap-1.5"><Code2 size={12} />{eventCount.current} edits</span><span className="flex items-center gap-1.5"><KeyRound size={12} />{keypressCount} keys</span><span className="flex items-center gap-1.5"><Upload size={12} />{events.filter((item) => item.type === "paste").length} pastes</span></div>
            <div className="flex items-center gap-2">
              {track === "adapt" && <button type="button" onClick={() => setAssistantOpen((open) => !open)} title={assistantOpen ? "Hide AI assistant" : "AI assistant"} aria-label={assistantOpen ? "Hide AI assistant" : "AI assistant"} aria-pressed={assistantOpen} className="inline-flex items-center gap-2 rounded-full border border-[#e4ebe5] px-3.5 py-2.5 text-[10px] font-semibold text-[#52645a] hover:bg-[#f5f9f6]">
                <Sparkles size={14} /><span className="hidden sm:inline">{assistantOpen ? "Hide assistant" : "AI assistant"}</span>
              </button>}
              {(track !== "skill" || !practicalTask) && <button type="button" onClick={runChecks} disabled={!consent} title={track === "problem-solver" ? "Run tests" : "Run checks"} aria-label={track === "problem-solver" ? "Run tests" : "Run checks"} className="inline-flex items-center gap-2 rounded-full border border-[#e4ebe5] px-3.5 py-2.5 text-[10px] font-semibold text-[#52645a] disabled:opacity-50">
                <ClipboardCheck size={14} /><span className="hidden sm:inline">{track === "problem-solver" ? "Run tests" : track === "skill" ? "Run build checks" : "Run checks"}</span>
              </button>}
              <button type="button" onClick={submit} disabled={!consent || !canSubmit || submitting || assistantBusy} title={submitting ? "Saving task" : "Submit task"} aria-label={submitting ? "Saving task" : "Submit task"} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:bg-[#28523d] disabled:cursor-not-allowed disabled:bg-[#aab8ad] sm:px-5">
                <span className="hidden sm:inline">{submitting ? "Saving…" : track === "skill" ? "Submit & start viva" : "Finish track"}</span><ArrowRight size={14} />
              </button>
            </div>
          </div>
          {error && <p role="alert" className="border-t border-[#f3d7d4] bg-[#fff7f6] px-5 py-3 text-xs text-[#a34c47]">{error}</p>}
        </section>
        {track === "adapt" && <aside className={`${assistantOpen ? "block" : "hidden"} overflow-hidden rounded-[20px] border border-[#e5ebe6] bg-white shadow-[0_6px_25px_#17321b08] xl:block`}>
          <div className="flex items-center justify-between border-b border-[#edf0ed] px-4 py-4"><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-[#f0effb] text-[#7167a8]"><Sparkles size={15} /></span><div><h2 className="text-[12px] font-semibold">AI assistant</h2><p className="text-[10px] text-[#98a29b]">Hints, not answers</p></div></div><button onClick={() => setAssistantOpen(false)} className="text-[#98a29b] xl:hidden" aria-label="Close assistant"><X size={15} /></button></div>
          <div className="max-h-[440px] min-h-[280px] space-y-3 overflow-y-auto px-4 py-4">
            <div className="rounded-xl border border-[#eeeafa] bg-[#faf9ff] p-3.5"><div className="flex gap-2 text-[11px] leading-[1.65] text-[#6c668b]"><Lightbulb size={14} className="mt-0.5 shrink-0" />Ask about a concept, edge case, or tradeoff. Your prompts are shared with the hiring team so they can understand how you used assistance.</div></div>
            {assistantBusy && <div className="mt-4 flex items-center gap-2 text-[11px] text-[#7a718f]"><span className="size-1.5 animate-pulse rounded-full bg-[#8177bb]" />Thinking through a hint…</div>}
            {prompts.map((item, index) => <div key={item.id || `${item.prompt}-${index}`} className="space-y-2 animate-rise"><div className="ml-5 rounded-xl bg-[#edf4ef] p-3 text-[10px] leading-4 text-[#52645a]">{item.prompt}</div><div className="mr-4 rounded-xl bg-[#f4f6f4] p-3 text-[10px] leading-[1.65] text-[#56645b]">{item.response}</div>
              <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-[#718078]"><input type="checkbox" checked={item.verified} onChange={(event) => void markSuggestion(item, "tested", event.target.checked)} className="mt-0.5 accent-[#477e55]" />I tested this suggestion</label>
              <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-[#718078]"><input type="checkbox" checked={Boolean(item.caught)} onChange={(event) => void markSuggestion(item, "caught", event.target.checked)} className="mt-0.5 accent-[#477e55]" />I caught a possible mistake</label>
              <p className="text-[9px] text-[#89958d]">{item.edited_after ? "Work edited after this answer." : "Edits made after this answer are recorded."}</p>
            </div>)}
          </div>
          <form onSubmit={askAssistant} className="border-t border-[#edf0ed] bg-[#fcfdfb] p-3">
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask for a hint or explanation…" rows={3} className="w-full resize-none rounded-xl border border-[#e6ebe7] bg-white p-3 text-[11px] leading-5 outline-none focus:border-[#aaa3d0]" />
            <button disabled={!prompt.trim() || assistantBusy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#eceaf7] py-2.5 text-[11px] font-semibold text-[#6a6396] transition hover:bg-[#e1def2] disabled:opacity-50"><WandSparkles size={13} />Ask assistant</button>
          </form>
        </aside>}
      </div>
      <p className="mt-4 text-center text-[10px] text-[#9aa59d]">Your process is visible only to the hiring team you share it with. <Link className="underline underline-offset-2" to="/">Privacy details</Link></p>
    </main>}
  </PageFrame>;
}

function Viva() {
  const flow = useAssessmentFlow();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [questions, setQuestions] = useState<McqQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | "">("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const candidateResult = await api.candidate(id);
        let result = await api.mcqQuestions(id);
        if (!result.questions.length) {
          const track = candidateResult.track === "adapt" ? "adapt" : "skill";
          result = await api.questions(id, { track, task: candidateResult.task_variant || candidateResult.code });
        }
        if (!active) return;
        setCandidate(candidateResult);
        setQuestions(result.questions);
        const firstUnanswered = result.questions.findIndex((question) => !question.submitted);
        const index = firstUnanswered >= 0 ? firstUnanswered : Math.max(0, result.questions.length - 1);
        setCurrent(index);
        setSelectedOption(result.questions[index]?.selectedOption || "");
      } catch (issue) {
        if (active) setError(issue instanceof Error ? issue.message : "Could not load viva.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [id]);
  const active = questions[current];

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!active || !selectedOption || active.submitted) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.answer(id, current, selectedOption);
      setQuestions((items) => items.map((item, index) => index === current ? {
        ...item,
        submitted: true,
        selectedOption,
        isCorrect: result.isCorrect,
        correctOption: result.correctOption,
        explanation: result.explanation,
      } : item));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save your answer."); }
    finally { setBusy(false); }
  }

  async function finishViva() {
    if (!candidate || questions.some((question) => !question.submitted) || completed) return;
    setBusy(true);
    setError("");
    try {
      const savedCandidate = await api.candidate(id);
      if (!savedCandidate.session_id || !isAssessmentTrack(savedCandidate.track) || savedCandidate.track === "problem-solver") {
        navigate(`/live-check/${id}`);
        return;
      }
      const taskVariant = (await api.task(savedCandidate.session_id)).task_variant;
      const requirement = savedCandidate.track === "adapt"
        ? await api.requirementChange(savedCandidate.session_id)
        : null;
      const taskChecks = checksForWork(savedCandidate.track, savedCandidate.domain || "javascript", savedCandidate.code,
        taskVariant, Boolean(requirement?.acknowledged));
      const practicalScore = Math.round(taskChecks.filter(Boolean).length / Math.max(1, taskChecks.length) * 100);
      const vivaScore = Math.round(savedCandidate.viva.reduce((sum, answer) => sum + (answer.score || 0), 0) /
        Math.max(1, savedCandidate.viva.length));
      const signals = trackSignals(savedCandidate, practicalScore);
      signals.viva = vivaScore;
      const track = savedCandidate.track;
      await api.submitTrackResult(savedCandidate.session_id, {
        track,
        domain: savedCandidate.domain || "javascript",
        task_variant: savedCandidate.task_variant || "",
        signals,
        evidence: {
          practical_score: practicalScore,
          mcq_score: vivaScore,
          ...(track === "skill" ? { skill_practical_score: practicalScore, skill_viva_score: vivaScore } : {
            adapt_practical_score: practicalScore,
            adapt_scenario_score: vivaScore,
            requirement_change_seen: Boolean(requirement?.acknowledged),
          }),
          task_checks: taskChecks,
          task_check_count: taskChecks.length,
          mcq_answers: questions.map((question) => ({
            scenario: question.scenario,
            question: question.question,
            selected_option: question.selectedOption,
            correct_option: question.correctOption,
            is_correct: question.isCorrect,
            explanation: question.explanation,
          })),
          domain: savedCandidate.domain || "javascript",
        },
      });
      setCompleted(true);
      navigate(`/assessments/result/${id}`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save the assessment results."); }
    finally { setBusy(false); }
  }

  function nextQuestion() {
    if (!active?.submitted) return;
    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setSelectedOption(questions[current + 1].selectedOption || "");
    } else {
      void finishViva();
    }
  }

  const isAdapt = candidate?.track === "adapt";
  const correctText = active?.correctOption ? active.options.find((option) => option.id === active.correctOption)?.text : "";
  const answeredCount = questions.filter((question) => question.submitted).length;

  if (loading) return <PageFrame><main className="mx-auto max-w-3xl px-5 py-20 text-sm text-[#849087]">Preparing task-specific questions…</main></PageFrame>;

  return <PageFrame><main className="mx-auto max-w-[850px] px-5 py-10 sm:py-14">
    <Link to="/assessments" className="inline-flex items-center gap-2 text-[12px] font-medium text-[#718078] hover:text-[#375b43]"><ArrowLeft size={14} /> Back to assessments</Link>
    <div className="mt-8 rounded-[24px] border border-[#e5ebe6] bg-white p-6 shadow-[0_12px_50px_#17321b0a] sm:p-9">
      <div className="flex items-start justify-between"><div><Pill><Sparkles size={11} /> {isAdapt ? "Adapt scenarios" : "AI viva"}</Pill><h1 className="app-page-title mt-4 text-[30px] font-semibold tracking-[-.045em]">{isAdapt ? "Choose the strongest workplace response." : "Show what you know about your task."}</h1><p className="mt-2 max-w-[600px] text-[13px] leading-6 text-[#748078]">{isAdapt ? "Work through realistic scenarios on automation, human–AI collaboration, inclusive workplaces, and workforce planning." : "Task-specific questions about the work you just completed. Select one answer, submit it, then review the explanation."}</p></div><span className="hidden size-11 place-items-center rounded-2xl bg-[#eef4ef] text-[#548164] sm:grid"><BrainCircuit size={21} /></span></div>
      {candidate && flow.journey.tracks.length > 1 && <div className="mt-5 rounded-xl border border-[#e7ece8] bg-[#fafcfb] p-3"><div className="flex items-center justify-between text-[9px] font-semibold text-[#7e8b82]"><span>Full assessment · {flow.journey.currentIndex + 1} of 3</span><span>{trackLabels[candidate.track || "skill"]}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e6ece7]"><div className="h-full rounded-full bg-[#69a579]" style={{ width: `${((flow.journey.currentIndex + 1) / 3) * 100}%` }} /></div></div>}
      <div className="mt-7 flex items-center gap-2" aria-label="Question progress">{questions.map((question, index) => <div key={index} className={`h-1.5 flex-1 rounded-full ${question.submitted ? "bg-[#5a9a6d]" : index === current ? "bg-[#a6c8ad]" : "bg-[#e8ede9]"}`} />)}</div>
      <div className="mt-2 flex justify-between text-[10px] font-medium text-[#95a098]"><span>Question {questions.length ? current + 1 : 0} of {questions.length}</span><span>{answeredCount} answered</span></div>
      <form onSubmit={submitAnswer} className="mt-7">
        <div className="rounded-2xl border border-[#e7ece8] bg-[#fafbf9] p-5 sm:p-6">
          {active ? <>
            <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#7b8f80]">Question {current + 1}</div>
            {active.scenario && <div className="mt-3 rounded-xl border border-[#e8ece8] bg-white px-4 py-3 text-[11px] leading-5 text-[#68766d]"><strong className="text-[#4c805a]">Scenario</strong><p className="mt-1">{active.scenario}</p></div>}
            <h2 className="mt-3 text-[19px] font-semibold leading-7 tracking-[-.02em]">{active.question}</h2>
            <fieldset className="mt-5 space-y-2" disabled={active.submitted || busy}>
              <legend className="mb-2 text-[10px] font-semibold text-[#87938b]">Choose one answer</legend>
              {active.options.map((option) => {
                const isSelected = (active.submitted ? active.selectedOption : selectedOption) === option.id;
                const isCorrect = active.submitted && active.correctOption === option.id;
                const isIncorrectSelection = active.submitted && isSelected && !active.isCorrect;
                return <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-[11px] leading-5 transition ${isCorrect ? "border-[#a8d1b0] bg-[#f0f8f1] text-[#3d7049]" : isIncorrectSelection ? "border-[#e8bdb8] bg-[#fff5f3] text-[#9c4d47]" : isSelected ? "border-[#83ae8d] bg-[#f2f8f3] text-[#41594a]" : "border-[#e6ebe7] bg-white text-[#68766d] hover:border-[#b8cbbb]"}`}>
                  <input type="radio" name="mcq-answer" value={option.id} checked={isSelected} onChange={() => setSelectedOption(option.id)} className="mt-1 accent-[#477e55]" />
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#eef3ef] text-[9px] font-semibold text-[#607568]">{option.id}</span>
                  <span>{option.text}</span>
                </label>;
              })}
            </fieldset>
            {active.submitted && <div role="status" className={`mt-4 rounded-xl border px-4 py-3 text-[11px] leading-5 ${active.isCorrect ? "border-[#d7e9da] bg-[#f2f8f3] text-[#577160]" : "border-[#f0dfbd] bg-[#fff9eb] text-[#82652e]"}`}>
              <strong>{active.isCorrect ? "Correct." : `Not quite. The correct answer is ${active.correctOption}${correctText ? `: ${correctText}` : "."}`}</strong>
              <p className="mt-1">{active.explanation}</p>
            </div>}
          </> : <div className="flex items-center gap-2 py-4 text-sm text-[#758178]">No questions are available for this assessment.</div>}
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff4f2] px-4 py-3 text-xs text-[#a34c47]">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-[#89958d]">{active?.submitted ? "Your answer and explanation have been saved." : "The correct answer is shown after you submit."}</p>
          {active?.submitted
            ? <button type="button" disabled={busy || current + 1 === questions.length && questions.some((question) => !question.submitted)} onClick={nextQuestion} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[12px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]">{current + 1 === questions.length ? busy ? "Saving results…" : "View results" : "Next question"}<ArrowRight size={14} /></button>
            : <button disabled={!active || !selectedOption || busy} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-5 py-3 text-[12px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]">{busy ? "Saving answer…" : "Submit answer"}<ArrowRight size={14} /></button>}
        </div>
      </form>
    </div>
    <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-[#98a29b]"><LockKeyhole size={12} />Your answers are shared with the hiring team for this assessment only.</div>
  </main></PageFrame>;
}

function LiveCheckChallenge() {
  const flow = useAssessmentFlow();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [extraTime, setExtraTime] = useState(false);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(240);
  const [selectedFix, setSelectedFix] = useState("plain-object");
  const [attempts, setAttempts] = useState(0);
  const [lastTest, setLastTest] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<boolean[] | null>(null);
  const [focusChanges, setFocusChanges] = useState(0);
  const [blurEvents, setBlurEvents] = useState(0);
  const [idlePeriods, setIdlePeriods] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const lastActivity = useRef(Date.now());
  const idleStarted = useRef(0);
  const duration = extraTime ? 360 : 240;
  const requirementChanged = running && duration - remaining >= 45;

  useEffect(() => {
    api.candidate(id).then((value) => {
      setCandidate(value);
      setExtraTime(Boolean(value.extra_time));
    }).catch((issue) => setError(issue instanceof Error ? issue.message : "Could not load live skill check."));
  }, [id]);

  useEffect(() => {
    if (!running) return;
    lastActivity.current = Date.now();
    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    const visibility = () => {
      if (document.visibilityState === "hidden") setFocusChanges((value) => value + 1);
    };
    const blur = () => {
      setBlurEvents((value) => value + 1);
      setFocusChanges((value) => value + 1);
    };
    const activity = () => {
      if (idleStarted.current) {
        const idleSeconds = Math.max(1, Math.round((Date.now() - idleStarted.current) / 1000));
        setIdlePeriods((current) => [...current, idleSeconds]);
        idleStarted.current = 0;
      }
      lastActivity.current = Date.now();
    };
    const idleTimer = window.setInterval(() => {
      if (!idleStarted.current && Date.now() - lastActivity.current >= 30000) idleStarted.current = lastActivity.current;
    }, 5000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(idleTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      if (idleStarted.current) {
        const idleSeconds = Math.max(1, Math.round((Date.now() - idleStarted.current) / 1000));
        setIdlePeriods((current) => [...current, idleSeconds]);
        idleStarted.current = 0;
      }
    };
  }, [running]);
  useEffect(() => {
    if (running && remaining === 0) setRunning(false);
  }, [remaining, running]);

  function runTests() {
    if (!running) return;
    setAttempts((value) => value + 1);
    const results = selectedFix === "null-prototype" ? [true, true, true, true] :
      selectedFix === "validate-key" ? [true, true, false, true] : [true, true, false, false];
    setTestResults(results);
    setLastTest(results.filter(Boolean).length);
  }

  async function submitCheck() {
    if (lastTest === null || !candidate) return;
    setSubmitting(true);
    setError("");
    const passed = lastTest;
    try {
      await api.liveCheck(id, {
        passed,
        total: 4,
        attempts,
        duration_seconds: Math.min(duration, Math.max(0, duration - remaining)),
        focus_changes: focusChanges,
        blur_events: blurEvents,
        idle_periods: idlePeriods,
        selected_fix: selectedFix,
        requirement_change_seen: requirementChanged,
      });
      const complete = await api.complete(id);
      const nextTrack = flow.advance("problem-solver", complete.track_results?.find((result) => result.track === "problem-solver")?.score ?? complete.score);
      if (nextTrack) navigate(`/assessments/${nextTrack}`, { state: { fullSequence: true } });
      else navigate(`/candidates/${complete.id}`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save your live skill check.");
    } finally {
      setSubmitting(false);
    }
  }

  const time = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  if (error && !candidate) return <PageFrame><main className="mx-auto max-w-3xl px-5 py-20"><p role="alert" className="rounded-xl bg-[#fff5f3] p-4 text-sm text-[#a34c47]">{error}</p></main></PageFrame>;
  if (!candidate) return <PageFrame><main className="mx-auto max-w-3xl px-5 py-20 text-sm text-[#849087]">Loading live skill check…</main></PageFrame>;
  if (candidate.live_check) return <PageFrame><main className="mx-auto max-w-[760px] px-5 py-14">
    <div className="rounded-[24px] border border-[#e5ebe6] bg-white p-7 text-center shadow-[0_12px_50px_#17321b0a]">
      <CheckCircle2 className="mx-auto text-[#4e9666]" size={28} />
      <h1 className="app-page-title mt-4 text-2xl font-semibold">Live skill check recorded</h1>
      <p className="mt-2 text-sm text-[#738078]">{candidate.live_check.passed} of {candidate.live_check.total} tests passed.</p>
      <Link to={`/candidates/${candidate.id}`} className="primary-glow mt-6 inline-flex rounded-full bg-[#1d3d2e] px-5 py-3 text-xs font-semibold text-white">View assessment report</Link>
    </div>
  </main></PageFrame>;

  return <PageFrame><main className="mx-auto max-w-[1050px] px-5 pb-12 pt-8">
    <Link to={`/viva/${id}`} className="inline-flex items-center gap-2 text-[11px] font-medium text-[#77847c]"><ArrowLeft size={13} /> Viva</Link>
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div><Pill><Code2 size={11} /> Final practical check</Pill><h1 className="app-page-title mt-3 text-[30px] font-semibold tracking-[-.05em]">Debug a grouping edge case.</h1><p className="mt-2 max-w-[640px] text-[13px] leading-6 text-[#748078]">A short, timed follow-up about a JavaScript object-key bug. Choose a fix, run the focused test suite, and explain the evidence in the report.</p></div>
      <div className={`rounded-2xl border px-4 py-3 ${remaining < 45 ? "border-[#f0d7d4] bg-[#fff6f5] text-[#a34c47]" : "border-[#e5ebe6] bg-white text-[#344b3b]"}`}><div className="text-[9px] font-semibold uppercase tracking-[.12em] opacity-70">Time remaining</div><div className="mt-1 flex items-center gap-2 font-mono text-2xl font-semibold"><Clock3 size={17} />{time}</div></div>
    </div>
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
      <section className="overflow-hidden rounded-[20px] border border-[#e5ebe6] bg-white">
        <div className="border-b border-[#edf0ed] px-5 py-4"><h2 className="text-sm font-semibold">The bug</h2><p className="mt-1 text-[11px] leading-5 text-[#78847c]">The current accumulator uses a normal object. Grouping a key such as <code>__proto__</code> can collide with inherited object properties.</p></div>
        <pre className="overflow-auto bg-[#111b18] p-5 font-mono text-[11px] leading-6 text-[#c0d0c4]">{`function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key];
    (groups[value] ??= []).push(item);
    return groups;
  }, {});
}`}</pre>
        <div className="space-y-2 p-5">
          {requirementChanged && <div role="status" className="mx-5 mt-4 rounded-xl border border-[#f0dfbd] bg-[#fff9eb] p-3.5 text-[10px] leading-5 text-[#82652e]"><strong>Requirement update:</strong> also account for items where the selected property is missing. Explain how your chosen approach handles that case.</div>}
          {[["plain-object", "Keep a regular {} accumulator", "Works for ordinary strings, but inherited keys can collide."], ["validate-key", "Check hasOwnProperty before appending", "Guards lookup, but assignment to special object keys remains unsafe."], ["null-prototype", "Create the accumulator with Object.create(null)", "Avoids inherited property names while preserving object-style grouping."]].map(([value, title, description]) => <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition ${selectedFix === value ? "border-[#9cc5a5] bg-[#f4faf5]" : "border-[#e7ece8] hover:bg-[#fafcfb]"}`}>
            <input type="radio" name="fix" value={value} checked={selectedFix === value} onChange={() => setSelectedFix(value)} disabled={!running} className="mt-1 accent-[#39734d]" />
            <span><span className="block text-[11px] font-semibold text-[#46564b]">{title}</span><span className="mt-1 block text-[10px] leading-4 text-[#849087]">{description}</span></span>
          </label>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ed] bg-[#fcfdfb] px-5 py-4">
          <span className="text-[10px] text-[#89958d]">Attempts: {attempts}{lastTest !== null && <span className="ml-2">· Last run: {lastTest}/4 passed</span>}</span>
          <button onClick={runTests} disabled={!running || remaining === 0} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-4 py-2.5 text-[11px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]"><Code2 size={13} />Run tests</button>
        </div>
        {lastTest !== null && <div aria-live="polite" className="border-t border-[#edf0ed] px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold text-[#56645b]">Focused test results</div>
          {["Ordinary category values", "Empty input", "Prototype-sensitive key (__proto__)", "Missing selected property"].map((test, index) => {
            const passed = testResults?.[index] ?? false;
            return <div key={test} className="flex items-center justify-between border-t border-[#f1f3f1] py-2 text-[10px]"><span className="text-[#748078]">{test}</span><span className={passed ? "font-medium text-[#4c805a]" : "font-medium text-[#a34c47]"}>{passed ? "Passed" : "Failed"}</span></div>;
          })}
        </div>}
      </section>
      <aside className="space-y-4">
        <section className="rounded-[20px] border border-[#e5ebe6] bg-white p-5">
          <h2 className="text-[12px] font-semibold">Before you start</h2>
          <p className="mt-2 text-[10px] leading-5 text-[#7b887e]">This demo challenge uses a constrained fix selector. It does not execute submitted code. With your consent, we record test attempts, elapsed time, tab switches, window-focus loss, and long idle periods. No camera or microphone is used.</p>
          {!running && <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-[#67756c]"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-[#477e55]" />I understand this timed check records test attempts, time, and tab visibility.</label>
            <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-4 text-[#67756c]"><input type="checkbox" checked={extraTime} onChange={(event) => setExtraTime(event.target.checked)} className="mt-0.5 accent-[#477e55]" />Accessibility option: add two minutes</label>
            <button onClick={() => { setRemaining(duration); setRunning(true); }} disabled={!consent} className="primary-glow w-full rounded-full bg-[#1d3d2e] px-4 py-3 text-[11px] font-semibold text-white disabled:bg-[#aab8ad]">Start {Math.round(duration / 60)}-minute check</button>
          </div>}
          {running && <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#edf6ef] p-3 text-[10px] font-medium text-[#4d805b]"><span className="size-2 animate-pulse rounded-full bg-[#55a66d]" />Timed check active · visibility monitoring on</div>}
          {remaining === 0 && <p className="mt-3 text-[10px] text-[#9b6b22]">Time is up. Save the latest test result to continue.</p>}
        </section>
        <section className="rounded-[20px] border border-[#e5ebe6] bg-[#f7faf7] p-5">
          <div className="flex items-center justify-between"><h2 className="text-[11px] font-semibold text-[#435349]">Progress</h2><span className="text-[10px] text-[#859188]">{lastTest ?? 0}/4 tests passed</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e6ece7]"><div className="h-full rounded-full bg-[#69a579] transition-all" style={{ width: `${((lastTest ?? 0) / 4) * 100}%` }} /></div>
          <p className="mt-3 text-[9px] leading-4 text-[#89958d]">A test result is one part of the evidence. Focus changes and test attempts are not standalone decisions.</p>
        </section>
        {error && <p role="alert" className="rounded-xl bg-[#fff4f2] px-4 py-3 text-xs text-[#a34c47]">{error}</p>}
        <button onClick={submitCheck} disabled={!candidate || lastTest === null || submitting} className="primary-glow w-full rounded-full bg-[#1d3d2e] px-5 py-3 text-[12px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#aab8ad]">{submitting ? "Saving evidence…" : "Finish & view report"}<ArrowRight className="ml-2 inline" size={14} /></button>
      </aside>
    </div>
  </main></PageFrame>;
}

function VerdictTone({ verdict }: { verdict: Candidate["verdict"] }) {
  const tone = verdict === "Verified skill" ? "green" : verdict === "Needs review" ? "amber" : "red";
  const Icon = verdict === "Verified skill" ? BadgeCheck : verdict === "Needs review" ? CircleHelp : Flag;
  return <Pill tone={tone} verified={verdict === "Verified skill"}><Icon size={12} />{verdict}</Pill>;
}

function ScoreRing({ score, size = 68 }: { score: number; size?: number }) {
  return <div className="relative grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(#4195d0 ${Math.max(0, Math.min(score, 100)) * 3.6}deg, #24435f 0deg)` }}>
    <div className="grid place-items-center rounded-full bg-white" style={{ width: size - 7, height: size - 7 }}><span className="text-[18px] font-semibold tracking-tight text-[#23362a]">{score}<span className="text-[9px] text-[#94a098]">%</span></span></div>
  </div>;
}

const trackLabels: Record<string, string> = {
  "problem-solver": "Problem Solver",
  skill: "Skill",
  adapt: "Adapt",
};
const domainLabels: Record<string, string> = {
  javascript: "JavaScript",
  python: "Python",
  sql: "SQL",
  marketing: "Marketing",
  accounting: "Accounting",
};

function trackPassed(result: TrackResult | undefined) {
  return Boolean(result && result.score >= 70 &&
    result.signals.viva >= 70 && result.signals.liveCheck >= 70);
}

function TrackScoreRing({ result, track }: { result?: TrackResult; track: string }) {
  const score = result?.score;
  const color = score === undefined ? "#819bb4" : trackPassed(result) ? "#4195d0" : score < 45 ? "#be6b62" : "#b58b47";
  return <div className="flex min-w-[54px] flex-col items-center gap-1" title={`${trackLabels[track]}: ${score === undefined ? "No score yet" : `${score}/100`}`}>
    <div aria-label={`${trackLabels[track]} score ${score === undefined ? "not available" : `${score} out of 100`}`} className="relative grid size-9 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${score === undefined ? 0 : Math.max(0, Math.min(score, 100)) * 3.6}deg, #24435f 0deg)` }}>
      <span className="grid size-[29px] place-items-center rounded-full bg-white text-[9px] font-semibold tabular-nums text-[#34483a]">{score === undefined ? "—" : score}</span>
    </div>
    <span className="text-center text-[8px] leading-3 text-[#869188]">{trackLabels[track]}</span>
  </div>;
}

function passedTrackResults(candidate: Candidate) {
  return (candidate.track_results || []).filter(trackPassed);
}

function trackSignalEvidence(result: TrackResult, signal: string, candidate: Candidate) {
  const evidence = result.evidence;
  const signalEvidence = evidence.signalEvidence;
  if (signalEvidence && typeof signalEvidence === "object" &&
      typeof (signalEvidence as Record<string, unknown>)[signal] === "string") {
    return (signalEvidence as Record<string, string>)[signal];
  }
  const number = (key: string) => typeof evidence[key] === "number" ? Number(evidence[key]) : null;
  const explanation = typeof evidence.explanation === "string" ? evidence.explanation : "";
  if (signal === "viva") {
    const answers = number("viva_answers");
    return answers === null
      ? explanation || "The score reflects the candidate’s explanation of their approach and decisions."
      : `Answered ${answers} viva questions. ${explanation}`;
  }
  if (signal === "process") {
    const runs = number("test_runs");
    const edits = candidate.events.reduce((sum, event) => sum + (event.type === "edit" ? event.count : 0), 0);
    return runs === null
      ? `${edits} edit actions were recorded. ${explanation || "Review the process timeline alongside the finished work."}`
      : `${runs} test runs and iterative work were recorded. ${explanation}`;
  }
  if (signal === "aiUsage") {
    const tested = number("assistant_answers_tested");
    const caught = number("assistant_mistakes_caught");
    if (tested !== null || caught !== null) return `Tested ${tested ?? 0} assistant answers and identified ${caught ?? 0} potential mistakes.`;
    const prompts = candidate.ai_prompts.length;
    return prompts ? `${prompts} assistant answer${prompts === 1 ? "" : "s"} were recorded; review whether suggestions were checked.` : "No assistant use was recorded; AI use itself is not required or penalized.";
  }
  if (signal === "liveCheck") {
    const passed = number("tests_passed");
    const total = number("tests_total");
    if (passed !== null && total !== null) return `${passed} of ${total} task checks passed. ${explanation}`;
    return `${Math.round(result.signals.liveCheck)}% of the live-check signal. ${explanation || "See the recorded test evidence for details."}`;
  }
  if (signal === "timeAndPaste") {
    const firstFix = number("time_to_first_fix_seconds");
    if (firstFix !== null) return `First passing fix was recorded after ${Math.floor(firstFix / 60)}m ${firstFix % 60}s.`;
    return `${Math.round(candidate.duration_seconds / 60)} minutes of work were recorded; time and pasting are contextual evidence, not proof by themselves.`;
  }
  return explanation || "This signal contributes context to the assessment.";
}

function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [trackFilter, setTrackFilter] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    api.candidates()
      .then(setCandidates)
      .catch((issue) => setError(issue instanceof Error ? issue.message : "Could not load candidate list."))
      .finally(() => setLoading(false));
  }, []);
  const filtered = useMemo(() => candidates.filter((candidate) =>
    (filter === "All" || candidate.verdict === filter) &&
    (trackFilter === "all" || candidate.track_results?.some((result) => result.track === trackFilter)) &&
    `${candidate.name} ${candidate.role} ${candidate.task_variant || ""}`.toLowerCase().includes(query.toLowerCase()),
  ), [candidates, filter, query, trackFilter]);
  const verified = candidates.filter((candidate) => candidate.verdict === "Verified skill").length;
  const review = candidates.filter((candidate) => candidate.verdict === "Needs review").length;
  const lowConfidence = candidates.filter((candidate) => candidate.verdict === "Low confidence").length;
  const averageScore = candidates.length ? Math.round(candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length) : 0;
  return <PageFrame dashboard><div className="mx-auto grid max-w-[1450px] gap-5 px-5 pb-12 pt-6 lg:grid-cols-[215px_minmax(0,1fr)] lg:px-8">
    <aside className="h-fit rounded-[20px] border border-[#e6ece7] bg-white p-3 shadow-[0_6px_20px_#1c352808] lg:sticky lg:top-24">
      <div className="px-3 py-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#9aa49c]">Workspace</div>
      <Link to="/dashboard" title="Candidate overview" aria-label="Candidate overview" className="flex items-center justify-center gap-2.5 rounded-xl bg-[#edf5ef] px-3 py-2.5 text-[11px] font-semibold text-[#426f4d] sm:justify-start"><LayoutDashboard size={15} /><span className="hidden sm:inline">Overview</span></Link>
      <Link to="/verify" title="Credential verification" aria-label="Credential verification" className="mt-1 flex items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-[11px] font-medium text-[#728078] hover:bg-[#f7faf7] sm:justify-start"><BadgeCheck size={15} /><span className="hidden sm:inline">Verify</span></Link>
      <Link to="/assessment" title="Invite candidate" aria-label="Invite candidate" className="mt-1 flex items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-[11px] font-medium text-[#728078] hover:bg-[#f7faf7] sm:justify-start"><Plus size={15} /><span className="hidden sm:inline">Invite</span></Link>
      <div className="mt-4 rounded-xl bg-[#f7faf7] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-[#4c6854]"><ShieldCheck size={13} /> Fair review</div><p className="mt-1.5 text-[9px] leading-4 text-[#87938b]">Scores summarize evidence; a human makes the final decision.</p></div>
    </aside>
    <main className="min-w-0">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8e9b91]">Hiring workspace / Overview</p><h1 className="app-page-title mt-1 text-[27px] font-semibold tracking-[-.05em] sm:text-[32px]">Candidate evidence</h1><p className="mt-1 text-[11px] text-[#7d8981]">Review the process, understanding, and context behind each assessment.</p></div>
        <label className="relative block w-full sm:max-w-[270px]"><span className="sr-only">Search candidates</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates or tasks" className="w-full rounded-full border border-[#e3e9e4] bg-white px-4 py-3 text-[11px] outline-none transition focus:border-[#91b99a] focus:ring-4 focus:ring-[#e8f4eb]" /></label>
      </div>
      <div aria-busy={loading} className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { icon: Users, name: "Candidates", value: candidates.length, color: "bg-[#eef4ef] text-[#4b7f5a]" },
          { icon: BadgeCheck, name: "Verified", value: verified, color: "bg-[#eaf5ed] text-[#4b815b]" },
          { icon: CircleHelp, name: "Needs review", value: review, color: "bg-[#fff4df] text-[#a07431]" },
          { icon: BarChart3, name: "Average score", value: `${averageScore}/100`, color: "bg-[#eef1f7] text-[#65749a]" },
        ].map(({ icon: Icon, name: label, value, color }) => <div key={label} className="rounded-2xl border border-[#e6ece7] bg-white px-4 py-3.5 shadow-[0_6px_20px_#1c352808] sm:px-5">
          <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium text-[#78847c]">{label}</span><span className={`grid size-7 place-items-center rounded-lg ${color}`}><Icon size={14} /></span></div>
          <div className="mt-2 text-[24px] font-semibold tracking-[-.05em] tabular-nums text-[#26372d]">{loading ? <SkeletonLoader className="h-7 w-10 rounded-lg" /> : value}</div>
        </div>)}
      </div>
      <section aria-busy={loading} className="mt-5 overflow-hidden rounded-[20px] border border-[#e6ece7] bg-white shadow-[0_8px_28px_#1c352808]">
        <div className="flex flex-col justify-between gap-3 border-b border-[#edf0ed] px-5 py-4 sm:flex-row sm:items-center"><div><h2 className="text-[14px] font-semibold">Recent assessments</h2><p className="mt-1 text-[10px] text-[#8b978f]">Evidence is a guide for human review, never an automated hiring decision.</p></div><Link to="/assessment" className="primary-glow inline-flex items-center justify-center gap-2 rounded-full bg-[#1d3d2e] px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-[#28523d]"><Plus size={13} /> Invite a candidate</Link></div>
        <div role="group" aria-label="Filter candidates by track" className="flex flex-wrap gap-2 border-b border-[#edf0ed] px-5 py-3">
          {[{ label: "All tracks", value: "all" }, ...Object.entries(trackLabels).map(([value, label]) => ({ label, value }))].map(({ label, value }) =>
            <button key={value} type="button" onClick={() => setTrackFilter(value)} aria-pressed={trackFilter === value} className={`rounded-full border px-3.5 py-2 text-[10px] font-semibold transition ${trackFilter === value ? "border-[#c9dfce] bg-[#edf6ef] text-[#457351]" : "border-[#e8ece8] bg-white text-[#7e8982] hover:bg-[#f8faf8]"}`}>{label}</button>,
          )}
        </div>
        <div role="group" aria-label="Filter candidates by verdict" className="flex flex-wrap gap-2 border-b border-[#edf0ed] px-5 py-3">
          {[
            { label: "All", value: "All", icon: LayoutDashboard },
            { label: "Verified", value: "Verified skill", icon: BadgeCheck },
            { label: "Needs review", value: "Needs review", icon: CircleHelp },
            { label: "Low confidence", value: "Low confidence", icon: Flag },
          ].map(({ label, value, icon: Icon }) => <button key={value} type="button" onClick={() => setFilter(value)} aria-label={label} aria-pressed={filter === value} title={label} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[10px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#426f4d] ${filter === value ? "border-[#c9dfce] bg-[#edf6ef] text-[#457351]" : "border-[#e8ece8] bg-white text-[#7e8982] hover:bg-[#f8faf8]"}`}><Icon size={13} />{label}{value === "Low confidence" ? ` · ${lowConfidence}` : ""}</button>)}
        </div>
        {error && <p role="alert" className="border-b border-[#f2dbd8] bg-[#fff7f6] px-5 py-3 text-xs text-[#a34c47]">{error}</p>}
        {loading && <div role="status" className="space-y-3 px-5 py-5"><span className="sr-only">Loading candidate assessments</span>{[0, 1, 2].map((row) => <div key={row} className="flex items-center gap-3 border-b border-[#f0f2f0] pb-4 last:border-0"><SkeletonLoader className="size-9 shrink-0 rounded-full" /><SkeletonLoader className="h-3 w-36 rounded" /><SkeletonLoader className="ml-auto h-5 w-20 rounded-full" /></div>)}</div>}
        {!loading && filtered.map((candidate) => <Link key={candidate.id} to={`/candidates/${candidate.id}`} className="group grid gap-3 border-t border-[#f0f2f0] px-5 py-4 transition hover:bg-[#fbfdfb] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#edf4ee] text-[11px] font-semibold text-[#487453]">{candidate.name.split(" ").map((word) => word[0]).join("")}</span><div className="min-w-0"><div className="truncate text-[12px] font-semibold group-hover:text-[#39734d]">{candidate.name}</div><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#8e9992]"><span>{candidate.role}</span><span>·</span><span>{candidate.task_variant || "Skills assessment"}</span><span>·</span><span>{candidate.status === "In progress" ? "In progress" : new Date(candidate.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span><VerdictTone verdict={candidate.verdict} /></span></div></div></div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
            <div className="flex items-center gap-2.5 rounded-xl bg-[#f7faf7] px-2.5 py-2"><ScoreRing score={candidate.score} size={48} /><div><div className="text-[9px] font-medium text-[#8a968e]">Authenticity Score</div><div className="text-[10px] font-semibold text-[#46584b]">{candidate.score}/100</div></div></div>
            <div className="flex gap-1">{Object.keys(trackLabels).map((track) => <TrackScoreRing key={track} track={track} result={candidate.track_results?.find((result) => result.track === track)} />)}</div>
            <span className="text-[10px] font-semibold text-[#477753] group-hover:underline">View report <ArrowRight className="ml-1 inline" size={12} /></span>
          </div>
        </Link>)}
        {!loading && !filtered.length && !error && <div className="px-5 py-12 text-center text-[12px] text-[#8b978f]">No candidates match this search.</div>}
      </section>
    </main>
  </div></PageFrame>;
}

function EvidenceCard({ title, icon: Icon, aside, children }: { title: string; icon: typeof Code2; aside?: ReactNode; children: ReactNode }) {
  return <section className="rounded-[18px] border border-[#e6ece7] bg-white"><div className="flex items-center justify-between border-b border-[#eef1ee] px-4 py-3.5 sm:px-5"><h2 className="flex items-center gap-2 text-[12px] font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-[#f0f5f1] text-[#558064]"><Icon size={14} /></span>{title}</h2>{aside}</div><div className="p-4 sm:p-5">{children}</div></section>;
}

function CandidateDetail() {
  const { id = "" } = useParams();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [scoringConfig, setScoringConfig] = useState<Awaited<ReturnType<typeof api.scoringConfig>> | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");
  useEffect(() => {
    Promise.all([api.candidate(id), api.scoringConfig()])
      .then(([candidateResult, config]) => { setCandidate(candidateResult); setScoringConfig(config); })
      .catch((issue) => setError(issue instanceof Error ? issue.message : "Could not load candidate evidence."));
    setActiveTab("Overview");
  }, [id]);
  if (error) return <PageFrame dashboard><main className="mx-auto max-w-3xl px-5 py-20"><p role="alert" className="rounded-xl bg-[#fff5f3] p-4 text-sm text-[#a34c47]">{error}</p><Link className="mt-4 inline-block text-sm text-[#4e7b5b]" to="/dashboard">Back to dashboard</Link></main></PageFrame>;
  if (!candidate || !scoringConfig) return <PageFrame dashboard><main className="mx-auto max-w-3xl px-5 py-20 text-sm text-[#849087]">Loading candidate evidence…</main></PageFrame>;
  const components = candidate.scoring_components || { viva: 0, process: 0, aiUsage: 75, liveCheck: 0, timeAndPaste: 0, aiText: 0 };
  const vivaScore10 = components.viva / 10;
  const verifiedPrompts = candidate.ai_prompts.filter((item) => item.verified).length;
  const seededMistakes = candidate.ai_prompts.filter((item) => item.seeded_mistake).length;
  const caughtMistakes = candidate.ai_prompts.filter((item) => item.seeded_mistake && (item.caught || item.edited_after)).length;
  const editedAfterPrompts = candidate.ai_prompts.filter((item) => item.edited_after).length;
  const elapsedAt = (time: string) => {
    const [eventMinutes, seconds] = time.split(":").map(Number);
    return (eventMinutes || 0) * 60 + (seconds || 0);
  };
  const activityBuckets = new Map<number, { minute: string; edits: number; pastes: number; tests: number; focus: number; changes: number }>();
  candidate.events.forEach((event) => {
    const minuteIndex = Math.floor(elapsedAt(event.time) / 60);
    const bucket = activityBuckets.get(minuteIndex) || {
      minute: `${minuteIndex}m`, edits: 0, pastes: 0, tests: 0, focus: 0, changes: 0,
    };
    if (event.type === "edit") bucket.edits += event.count;
    else if (event.type === "paste") bucket.pastes += event.count;
    else if (event.type === "run") bucket.tests += 1;
    else if (event.type === "tab" || event.type === "blur") bucket.focus += 1;
    else if (event.type === "requirement_change") bucket.changes += 1;
    activityBuckets.set(minuteIndex, bucket);
  });
  const activityData = Array.from(activityBuckets.values()).sort((a, b) => Number.parseInt(a.minute) - Number.parseInt(b.minute));
  const tabs = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Process replay", icon: Radio },
    { label: "Viva", icon: MessageSquareText },
    { label: "AI usage", icon: Sparkles },
    { label: "Live check", icon: Code2 },
    { label: "Credential", icon: BadgeCheck },
  ];
  const scoreRows = [
    ["Viva understanding", components.viva, scoringConfig.weights.viva],
    ["Process pattern", components.process, scoringConfig.weights.process],
    ["AI usage quality", components.aiUsage, scoringConfig.weights.aiUsage],
    ["Live skill check", components.liveCheck, scoringConfig.weights.liveCheck],
    ["Time and paste behavior", components.timeAndPaste, scoringConfig.weights.timeAndPaste],
    ["AI-text detection", 0, scoringConfig.weights.aiText],
  ] as const;
  const flagDetails = candidate.flag_details?.length ? candidate.flag_details : candidate.flags.map((evidence) => ({
    key: "review-note", evidence, explanation: "Discuss this evidence alongside the rest of the assessment.", weak_signal: false,
  }));
  const verdictReason = candidate.verdict_reason || "The evidence should be considered as a whole; a human reviewer makes the final decision.";
  const onCopy = async () => {
    const url = `${window.location.origin}/credential/${candidate.id}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError("Could not copy the credential link. You can open the credential page and copy its URL."); }
  };
  return <PageFrame dashboard><main className="mx-auto max-w-[1240px] px-5 pb-12 pt-8 lg:px-8">
    <Link to="/dashboard" className="inline-flex items-center gap-2 text-[11px] font-medium text-[#77847c] hover:text-[#385d44]"><ArrowLeft size={13} /> Candidate dashboard</Link>
    <div className="mt-5 flex flex-col justify-between gap-4 rounded-[20px] border border-[#e6ece7] bg-white p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-full bg-[#edf4ee] text-sm font-semibold text-[#487453]">{candidate.name.split(" ").map((word) => word[0]).join("")}</span><div><div className="flex flex-wrap items-center gap-2.5"><h1 className="app-page-title text-[22px] font-semibold tracking-[-.04em]">{candidate.name}</h1><VerdictTone verdict={candidate.verdict} /></div><p className="mt-1 text-[11px] text-[#849087]">{candidate.role} <span className="mx-1.5 text-[#c4ccc6]">·</span>{candidate.email || "Email not provided"} <span className="mx-1.5 text-[#c4ccc6]">·</span>{candidate.task_variant || "Skills assessment"}</p></div></div>
      <div className="flex items-center gap-4"><div className="flex items-center gap-3"><ScoreRing score={candidate.score} size={58} /><div><div className="text-[10px] text-[#8a968e]">Evidence score</div><div className="text-[12px] font-semibold">Weighted across signals</div></div></div>{candidate.credential_id && <button onClick={onCopy} className="inline-flex items-center gap-2 rounded-full border border-[#dce8df] px-3.5 py-2.5 text-[11px] font-semibold text-[#477753] hover:bg-[#f2f8f3]"><Copy size={13} />{copied ? "Copied" : "Copy credential link"}</button>}</div>
    </div>
    <div role="tablist" aria-label="Candidate evidence sections" className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-[#e6ece7] bg-white p-1.5">
      {tabs.map(({ label, icon: Icon }) => <button key={label} role="tab" title={label} aria-label={label} aria-selected={activeTab === label} onClick={() => setActiveTab(label)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-[10px] font-semibold transition sm:px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#426f4d] ${activeTab === label ? "bg-[#1d3d2e] text-white" : "text-[#77847c] hover:bg-[#f5f8f5]"}`}><Icon size={13} /><span>{label}</span></button>)}
    </div>

    {activeTab === "Overview" && <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.8fr)]">
      <div className="space-y-4">
        <EvidenceCard title="Three-track assessment breakdown" icon={ClipboardCheck} aside={<span className="text-[9px] text-[#89958d]">Track results and supporting evidence</span>}>
          {candidate.track_results?.length ? <div className="space-y-3">{Object.entries(trackLabels).map(([track, label]) => {
            const result = candidate.track_results?.find((item) => item.track === track);
            if (!result) return <div key={track} className="rounded-xl border border-dashed border-[#e4eae5] p-3 text-[10px] text-[#89958d]">{label}: no result recorded.</div>;
            const passed = trackPassed(result);
            const signalLabels: Record<string, string> = {
              viva: "Reasoning and explanation",
              process: "Step-by-step work",
              aiUsage: "Checking AI help",
              liveCheck: "Tests and output",
              timeAndPaste: "Time and pasted work",
            };
            return <div key={track} className="rounded-xl border border-[#e7ece8] bg-[#fcfdfb] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="text-[11px] font-semibold text-[#46584b]">{label}</h3><p className="mt-0.5 text-[9px] text-[#89958d]">Domain · {domainLabels[result.domain] || result.domain}</p></div>
                <div className="flex items-center gap-2"><span className="text-[12px] font-semibold tabular-nums text-[#34483a]">{result.score}/100</span><Pill tone={passed ? "green" : result.score < 45 ? "red" : "amber"}>{passed ? "Passed" : "Not passed"}</Pill></div>
              </div>
              <div className="mt-3 space-y-2">{Object.entries(result.signals).map(([signal, value]) => <div key={signal} className="rounded-lg bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-semibold text-[#637168]">{signalLabels[signal] || signal}</span><span className="text-[9px] font-semibold tabular-nums text-[#526158]">{value}/100</span></div>
                <p className="mt-1 text-[9px] leading-4 text-[#89958d]">{trackSignalEvidence(result, signal, candidate)}</p>
              </div>)}</div>
            </div>;
          })}</div> : <p className="text-[10px] text-[#89958d]">No per-track results have been submitted.</p>}
        </EvidenceCard>
        <EvidenceCard title={`Final verdict: ${candidate.verdict}`} icon={ShieldCheck}>
          <p className="text-[12px] leading-6 text-[#647168]">{verdictReason}</p>
          <div className="mt-4 rounded-xl border border-[#e4ece5] bg-[#f7faf7] p-4"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#4d7657]"><Shield size={14} /> Fairness by design</div><p className="mt-1.5 text-[10px] leading-5 text-[#7c8980]">No candidate is rejected on a single signal. A human reviewer makes the final decision; AI use and AI-text notes are never standalone evidence.</p></div>
        </EvidenceCard>
        <EvidenceCard title="Evidence flags" icon={Flag}>
          {flagDetails.length ? <div className="space-y-3">{flagDetails.map((flag, index) => <div key={`${flag.key}-${index}`} className="rounded-xl border border-[#ece8dd] bg-[#fffdf8] p-3.5"><div className="flex items-center gap-2 text-[10px] font-semibold text-[#866b3d]"><Flag size={12} />{flag.key.replaceAll("-", " ")}</div><p className="mt-2 text-[10px] leading-5 text-[#675f50]"><strong>Evidence:</strong> {flag.evidence}</p><p className="mt-1 text-[10px] leading-5 text-[#818078]">{flag.explanation}</p></div>)}</div> : <div className="flex items-center gap-2 text-[11px] text-[#598165]"><CheckCircle2 size={15} />No evidence flags.</div>}
        </EvidenceCard>
      </div>
      <EvidenceCard title="Scoring breakdown" icon={BarChart3}>
        <div className="space-y-3">{scoreRows.map(([label, value, weight]) => <div key={label}><div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]"><span className="font-medium text-[#647168]">{label}</span><span className="text-right text-[#929d95]">{Math.round(Number(weight) * 100)}% <strong className="ml-1 text-[#526158]">{value}</strong></span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#edf1ed]"><div className="h-full rounded-full bg-[#72a67e]" style={{ width: `${value}%` }} /></div></div>)}</div>
        <p className="mt-4 rounded-xl bg-[#f5f8f5] p-3 text-[10px] leading-5 text-[#819087]">AI-text analysis: <strong>0% weight</strong>. It is a weak style note only and may produce false positives, including for non-native English speakers.</p>
      </EvidenceCard>
    </div>}

    {activeTab === "Process replay" && <div className="mt-4 space-y-4">
      <EvidenceCard title="Activity over time" icon={BarChart3} aside={<span className="text-[10px] text-[#8c9890]">{candidate.events.length} events · {candidate.keystrokes} keypresses</span>}>
        {activityData.length ? <div className="h-[260px] w-full" role="img" aria-label="Bar chart showing edit, paste, test, focus, and requirement-change activity by minute">
          <Suspense fallback={<div role="status" className="grid h-full place-items-center text-[11px] text-[#829087]">Loading activity chart…</div>}><ActivityChart data={activityData} /></Suspense>
        </div> : <p className="py-8 text-center text-[11px] text-[#929d95]">No activity events were recorded.</p>}
      </EvidenceCard>
      <EvidenceCard title="Process timeline" icon={Radio} aside={<span className="text-[10px] text-[#8c9890]">{Math.floor(candidate.duration_seconds / 60)} min · {candidate.events.length} events</span>}>
        <div className="relative ml-2 space-y-0 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-[#e3ebe5]">
          {candidate.events.map((event, index) => {
            const Icon = event.type === "paste" ? Upload : event.type === "tab" || event.type === "blur" ? Eye : event.type === "idle" ? Clock3 : event.type === "run" ? Code2 : event.type === "requirement_change" ? Flag : Code2;
            const tone = event.type === "paste" ? "bg-[#fff2df] text-[#ad7931]" : event.type === "tab" || event.type === "blur" ? "bg-[#f0eff7] text-[#7c709b]" : event.type === "requirement_change" ? "bg-[#fff0ee] text-[#a75e54]" : "bg-[#edf5ef] text-[#4d805b]";
            const gap = index ? elapsedAt(event.time) - elapsedAt(candidate.events[index - 1].time) : 0;
            const gapLabel = gap >= 120 ? ` · ${Math.floor(gap / 60)}m gap` : "";
            const eventLabel = event.type === "edit" ? "Edit" : event.type === "paste" ? "Paste" : event.type === "run" ? "Test attempt" : event.type === "requirement_change" ? "Requirement change" : event.type === "idle" ? "Idle period" : "Focus change";
            return <div key={`${event.id || event.time}-${index}`} className="relative flex gap-3 pb-5 last:pb-0"><span className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full ring-4 ring-white ${tone}`}><Icon size={12} /></span><div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2"><div><div className="text-[11px] font-medium text-[#435349]">{event.detail}</div><div className="mt-1 text-[10px] text-[#96a098]">{eventLabel} · {event.count} {event.type === "paste" ? "lines" : event.type === "idle" ? "seconds" : "event"}{event.characters ? ` · ${event.characters} characters` : ""}{gapLabel}</div></div><span className="rounded-md bg-[#f4f6f4] px-2 py-1 font-mono text-[10px] text-[#7b8880]">{event.time}</span></div></div>;
          })}
        </div>
        {!candidate.events.length && <p className="text-[11px] text-[#929d95]">No replay events recorded.</p>}
      </EvidenceCard>
    </div>}

    {activeTab === "Viva" && <div className="mt-4 space-y-4">
      <EvidenceCard title="Viva: understanding in their own words" icon={MessageSquareText} aside={<Pill tone={vivaScore10 >= 7.5 ? "green" : vivaScore10 >= 5 ? "amber" : "red"}>{vivaScore10.toFixed(1)}/10 average</Pill>}>
        {candidate.viva.length ? <div className="space-y-4">{candidate.viva.map((item, index) => {
          const score = item.score === null ? null : Number(item.score) > 10 ? Number(item.score) / 10 : Number(item.score);
          return <div key={index} className="border-b border-[#f0f2f0] pb-4 last:border-0 last:pb-0"><div className="flex items-start justify-between gap-3"><p className="text-[11px] font-semibold leading-5 text-[#45554b]">{index + 1}. {item.question}</p><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${Number(score) >= 7.5 ? "bg-[#eaf5ed] text-[#4d805b]" : Number(score) >= 5 ? "bg-[#fff4df] text-[#9d712d]" : "bg-[#fceceb] text-[#a34c47]"}`}>{score === null ? "—" : score.toFixed(1)}/10</span></div><p className="mt-2 rounded-xl bg-[#fafbf9] p-3 text-[11px] leading-5 text-[#627168]">“{item.answer || "No answer recorded"}”</p>{item.feedback && <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-[#849087]"><Sparkles size={11} className="mt-0.5 shrink-0 text-[#977fc0]" />{item.feedback}</p>}</div>;
        })}</div> : <p className="text-[11px] text-[#89958d]">No viva answers recorded.</p>}
      </EvidenceCard>
    </div>}

    {activeTab === "AI usage" && <div className="mt-4 space-y-4">
      <EvidenceCard title="Assistant use: prompts and review" icon={Sparkles} aside={<Pill tone="gray">{candidate.ai_prompts.length} prompts</Pill>}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[["Prompts", candidate.ai_prompts.length], ["Verified", verifiedPrompts], ["Seeded mistakes caught", `${caughtMistakes}/${seededMistakes}`], ["Code improved after AI", editedAfterPrompts]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#f7faf7] p-3"><div className="text-[9px] text-[#8b978f]">{label}</div><div className="mt-1 text-[14px] font-semibold text-[#46584b]">{value}</div></div>)}
        </div>
        {candidate.ai_prompts.length ? <div className="space-y-3">{candidate.ai_prompts.map((item, index) => <div key={item.id || index} className="rounded-xl border border-[#eceaf4] bg-[#fcfbff] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8e879e]">Prompt {index + 1}</div><p className="mt-1.5 text-[11px] leading-5 text-[#615d77]">“{item.prompt}”</p>{item.response && <p className="mt-2 rounded-lg bg-white p-3 text-[10px] leading-5 text-[#727083]"><strong>Assistant response:</strong> {item.response}</p>}<div className="mt-3 flex flex-wrap gap-2 text-[9px] font-medium"><Pill tone={item.verified ? "green" : "gray"} verified={item.verified}>{item.verified ? "Verified by candidate" : "Not marked verified"}</Pill>{item.seeded_mistake && <Pill tone={item.caught || item.edited_after ? "green" : "amber"}>{item.caught || item.edited_after ? "Seeded mistake caught" : "Seeded mistake not caught"}</Pill>}</div><p className="mt-2 text-[10px] leading-4 text-[#8a9190]">{item.summary}</p></div>)}</div> : <p className="text-[11px] text-[#89958d]">No assistant prompts recorded.</p>}
      </EvidenceCard>
      <EvidenceCard title="AI-text style note" icon={CircleHelp}>
        <p className="rounded-xl border border-[#e7e2d6] bg-[#fbf9f2] p-4 text-[11px] leading-6 text-[#786e59]"><strong>Weak signal, not used alone.</strong> {candidate.ai_text_note || "Response-length style observations may have false positives, including for non-native English speakers, and contribute 0% to the score."}</p>
        <p className="mt-3 text-[10px] leading-5 text-[#87938b]">This observation is not evidence of AI authorship and must not be used by itself to judge a candidate.</p>
      </EvidenceCard>
    </div>}

    {activeTab === "Live check" && <div className="mt-4">
      <EvidenceCard title="Timed live skill check" icon={Code2} aside={<Pill tone={candidate.live_check && candidate.live_check.score >= 70 ? "green" : "amber"}>{candidate.live_check ? `${candidate.live_check.score}%` : "Not completed"}</Pill>}>
        {candidate.live_check ? <div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[["Tests passed", `${candidate.live_check.passed}/${candidate.live_check.total}`], ["Test attempts", candidate.live_check.attempts], ["Time used", `${Math.floor(candidate.live_check.duration_seconds / 60)}m ${candidate.live_check.duration_seconds % 60}s`], ["Focus changes", candidate.live_check.focus_changes], ["Window blur events", candidate.live_check.blur_events || 0], ["Long idle periods", candidate.live_check.idle_periods?.length || 0]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#f7faf7] p-3"><div className="text-[9px] text-[#8b978f]">{label}</div><div className="mt-1 text-[12px] font-semibold text-[#46584b]">{value}</div></div>)}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-[#647168]">Selected fix: <strong>{candidate.live_check.selected_fix === "null-prototype" ? "null-prototype accumulator" : candidate.live_check.selected_fix === "validate-key" ? "key validation" : "regular object accumulator"}</strong>. Requirement update: <strong>{candidate.live_check.requirement_change_seen ? "shown" : "not reached"}</strong>.</p>
          <p className="mt-2 text-[10px] leading-5 text-[#849087]">Focus and timing are process notes, not standalone decisions. No video or audio was collected.</p>
        </div> : <p className="text-[11px] text-[#89958d]">No live skill check evidence recorded.</p>}
      </EvidenceCard>
    </div>}

    {activeTab === "Credential" && <div className="mt-4">
      <EvidenceCard title="Credential" icon={BadgeCheck}>
        {candidate.credential_id && candidate.verdict === "Verified skill" ? <div className="rounded-2xl border border-[#dce9df] bg-[#f8fbf8] p-5">
          <div className="flex items-start justify-between gap-4"><div><Pill verified><BadgeCheck size={11} /> Verified skill</Pill><h2 className="mt-3 text-[18px] font-semibold">{candidate.name}</h2><p className="mt-1 text-[11px] text-[#78847c]">Domain: {[...new Set(passedTrackResults(candidate).map((result) => domainLabels[result.domain] || result.domain))].join(", ") || domainLabels[candidate.domain || ""] || "Not recorded"}</p><p className="mt-1 font-mono text-[10px] text-[#89958d]">{candidate.credential_id}</p></div><CheckCircle2 className="shrink-0 text-[#4d8a5d]" size={28} /></div>
          <div className="mt-4 flex flex-wrap gap-2">{passedTrackResults(candidate).map((result) => <Pill key={result.track} verified><CheckCircle2 size={10} />{trackLabels[result.track] || result.track}</Pill>)}</div>
          <p className="mt-3 text-[10px] leading-5 text-[#78847c]">Issued {new Date(candidate.created_at).toLocaleDateString()}. {candidate.verdict_reason || "Verified through track evidence and human review."}</p>
          <Link to={`/credential/${candidate.id}`} className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#4c805a] hover:underline">Open credential card <ExternalLink size={11} /></Link>
        </div> : <div className="rounded-xl border border-[#ece7dc] bg-[#fbf8f1] p-4 text-[11px] leading-5 text-[#8a754f]">A public credential is issued only when the assessment reaches Verified skill. This candidate currently has no credential.</div>}
      </EvidenceCard>
      <EvidenceCard title="Submitted solution" icon={Code2}><pre className="scrollbar-thin overflow-auto rounded-xl bg-[#111b18] p-4 font-mono text-[11px] leading-6 text-[#c0d0c4]">{candidate.code}</pre></EvidenceCard>
    </div>}
  </main></PageFrame>;
}

function Verification() {
  const [searchParams] = useSearchParams();
  const queryCredentialId = searchParams.get("credentialId") || "";
  const [credentialId, setCredentialId] = useState(queryCredentialId);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [credential, setCredential] = useState<Awaited<ReturnType<typeof api.credential>>["credential"] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const verify = useCallback(async (value: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.verifyCredential(value);
      setCandidate(result);
      if (result.credential_id) {
        const credentialResult = await api.credential(result.credential_id);
        setCredential(credentialResult.credential);
      } else {
        setCredential(null);
      }
    } catch (issue) {
      setCandidate(null);
      setCredential(null);
      setError(issue instanceof Error ? issue.message : "Credential not found.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (queryCredentialId) {
      setCredentialId(queryCredentialId);
      void verify(queryCredentialId);
    }
  }, [queryCredentialId, verify]);
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = credentialId.trim();
    if (!trimmed) {
      setError("Enter a credential ID to verify.");
      setCandidate(null);
      return;
    }
    await verify(trimmed);
  }

  return <PageFrame><main className="mx-auto max-w-[820px] px-5 py-14 sm:py-18">
    <div className="rounded-[28px] border border-[#e6ece7] bg-white p-6 shadow-[0_18px_60px_#17321b10] sm:p-9">
      <div className="flex items-center justify-between gap-3"><div>
        <Pill><ShieldCheck size={11} /> Public verification</Pill>
        <h1 className="app-page-title mt-4 text-[30px] font-semibold tracking-[-.05em]">Verify a FutureFit credential</h1>
      </div><span className="grid size-11 place-items-center rounded-2xl bg-[#edf4ef] text-[#4d835d]"><BadgeCheck size={19} /></span></div>
      <p className="mt-3 max-w-[620px] text-[13px] leading-6 text-[#758078]">Enter a credential ID to confirm whether the candidate has a verified FutureFit assessment on file.</p>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input value={credentialId} onChange={(event) => setCredentialId(event.target.value)} placeholder="e.g. FF-8f31c4" className="w-full rounded-full border border-[#e3e9e4] bg-[#fafcfb] px-4 py-3 text-[13px] outline-none transition focus:border-[#8db7a0] focus:ring-4 focus:ring-[#e8f4eb]" />
        <button disabled={loading} className="primary-glow rounded-full bg-[#1d3d2e] px-5 py-3 text-[12px] font-semibold text-white hover:bg-[#28523d] disabled:bg-[#a9b8b0]">{loading ? "Checking…" : "Verify"}</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fff5f3] px-4 py-3 text-xs text-[#a34c47]">{error}</p>}
      {candidate && <div className="mt-6 rounded-2xl border border-[#e6ece7] bg-[#f8faf8] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#7a8d82]">Verified record</div>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-.04em] text-[#1d3327]">{candidate.name}</h2>
          </div>
          <Pill verified><BadgeCheck size={10} /> Verified skill</Pill>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[['Credential ID', credential?.credential_id || candidate.credential_id || '—'], ['Date issued', credential ? new Date(credential.issued_date).toLocaleDateString() : new Date(candidate.created_at).toLocaleDateString()], ['Domain verified', [...new Set(passedTrackResults(candidate).map((result) => domainLabels[result.domain] || result.domain))].join(", ") || domainLabels[candidate.domain || ""] || "Not recorded"], ['Authenticity Score', `${candidate.score}/100`], ['Role', candidate.role]].map(([label, value]) => <div key={label} className="rounded-xl bg-white p-3"><div className="text-[9px] uppercase tracking-[.12em] text-[#8c9990]">{label}</div><div className="mt-1 text-[12px] font-semibold text-[#2d4138]">{value}</div></div>)}
        </div>
        <div className="mt-4 rounded-xl border border-[#e3eae4] bg-white p-3.5">
          <div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8c9990]">Tracks passed</div>
          <div className="mt-2 flex flex-wrap gap-2">{passedTrackResults(candidate).length
            ? passedTrackResults(candidate).map((result) => <Pill key={result.track} verified><CheckCircle2 size={10} />{trackLabels[result.track] || result.track}</Pill>)
            : <span className="text-[10px] text-[#7d8981]">Track results are not available for this record.</span>}</div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3eae4] bg-white p-3.5">
          <div className="text-[11px] text-[#74827b]">{credential?.evidence_summary || "Evidence was reviewed across the recorded assessment."}</div>
          <Link to={`/credential/${candidate.id}`} className="inline-flex items-center gap-2 rounded-full border border-[#dfe8e1] px-3 py-2 text-[10px] font-semibold text-[#4a7257] hover:bg-[#f3faf4]">View public credential <ExternalLink size={11} /></Link>
        </div>
      </div>}
    </div>
  </main></PageFrame>;
}

function Credential() {
  const { id = "" } = useParams();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [credential, setCredential] = useState<Awaited<ReturnType<typeof api.credential>>["credential"] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.candidate(id).then(async (candidateResult) => {
      setCandidate(candidateResult);
      if (candidateResult.credential_id) {
        const result = await api.credential(candidateResult.credential_id);
        setCredential(result.credential);
      }
    }).catch((issue) => setError(issue instanceof Error ? issue.message : "Credential not found."))
      .finally(() => setLoaded(true));
  }, [id]);
  const credentialUrl = `${window.location.origin}/credential/${id}`;
  const verifyUrl = credential ? `${window.location.origin}/verify?credentialId=${encodeURIComponent(credential.credential_id)}` : "";
  const passedTracks = candidate ? passedTrackResults(candidate) : [];
  const verifiedDomains = [...new Set(passedTracks.map((result) => domainLabels[result.domain] || result.domain))];
  async function copy() {
    try { await navigator.clipboard.writeText(credentialUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setError("Could not copy this link. Copy the page URL from your browser."); }
  }
  async function share() {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "FutureFit credential", text: `${candidate?.name || "Candidate"}'s verified FutureFit credential`, url: credentialUrl });
      setShared(true);
      window.setTimeout(() => setShared(false), 1500);
    } catch (issue) {
      if (issue instanceof Error && issue.name !== "AbortError") setError("Could not share this credential. Use Copy link instead.");
    }
  }
  return <PageFrame><main className="mx-auto max-w-[760px] px-5 py-14 sm:py-20">
    <div className="flex justify-center"><Logo /></div>
    {error ? <div role="alert" className="mt-10 rounded-xl bg-[#fff5f3] p-4 text-sm text-[#a34c47]">{error}</div> : !loaded ? <p className="mt-12 text-center text-sm text-[#859188]">Verifying credential…</p> : !candidate?.credential_id || candidate.verdict !== "Verified skill" || !credential ? <div className="mt-10 rounded-2xl border border-[#e6ece7] bg-white p-8 text-center"><CircleHelp className="mx-auto text-[#ad8746]" /><h1 className="app-page-title mt-3 text-xl font-semibold">Credential unavailable</h1><p className="mt-2 text-sm text-[#7c8980]">This assessment has not earned a verified credential.</p></div> : <div className="relative mt-10 overflow-hidden rounded-[28px] border border-[#dce9df] bg-white shadow-[0_20px_70px_#17321b12]">
      <div className="absolute right-0 top-0 size-64 translate-x-20 -translate-y-20 rounded-full bg-[radial-gradient(circle,#e2f2e5_0%,transparent_70%)]" />
      <div className="relative border-b border-[#eef2ee] px-7 py-6 sm:px-10"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#77917d]">FutureFit credential</span><span className="grid size-10 place-items-center rounded-xl bg-[#eaf5ed] text-[#4d865b]"><BadgeCheck size={20} /></span></div></div>
      <div className="relative px-7 py-8 sm:px-10 sm:py-10"><Pill verified><CheckCircle2 size={12} /> Verified skill</Pill><h1 className="app-page-title mt-5 text-[32px] font-semibold tracking-[-.05em] sm:text-[40px]">{candidate.name}</h1><p className="mt-2 text-[14px] text-[#708077]">demonstrated understanding in a FutureFit assessment</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">{[
          ["Domain verified", verifiedDomains.join(", ") || domainLabels[candidate.domain || ""] || "Not recorded"],
          ["Date issued", new Date(credential.issued_date).toLocaleDateString()],
          ["Credential ID", credential.credential_id],
          ["Authenticity Score", `${candidate.score} / 100`],
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f7faf7] p-4"><div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8b9b8e]">{label}</div><div className="mt-1.5 break-words text-[12px] font-semibold text-[#3d5043]">{value}</div></div>)}</div>
        <div className="mt-5 rounded-xl border border-[#e7eee8] bg-[#fbfdfb] p-4">
          <div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#8b9b8e]">Tracks passed</div>
          <div className="mt-2 flex flex-wrap gap-2">{passedTracks.length
            ? passedTracks.map((result) => <Pill key={result.track} verified><CheckCircle2 size={10} />{trackLabels[result.track] || result.track}</Pill>)
            : <span className="text-[10px] text-[#78867d]">Track-level evidence is not available for this credential.</span>}</div>
          <p className="mt-3 text-[10px] leading-5 text-[#78867d]">{credential.evidence_summary}</p>
        </div>
        <div className="mt-6 flex flex-col gap-5 rounded-xl border border-[#e7eee8] p-4 sm:flex-row sm:items-center"><div className="qr-code-panel shrink-0 rounded-lg bg-white p-2"><QRCodeSVG value={verifyUrl} size={132} level="M" title="Scan to verify this FutureFit credential" /></div><div><h2 className="text-[12px] font-semibold text-[#435349]">Verify this credential</h2><p className="mt-1 text-[10px] leading-5 text-[#78867d]">Scan the QR code or use the public verification page to confirm this credential ID.</p><p className="mt-3 text-[10px] text-[#78867d]">Skills: {credential.skills.join(", ")}</p></div></div>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-[#e7eee8] p-4"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#5a9367]" /><p className="text-[10px] leading-5 text-[#78867d]">This credential summarizes passed track evidence and verified domains. It documents assessment performance; it is not a guarantee of job performance.</p></div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><Link to={`/verify?credentialId=${encodeURIComponent(credential.credential_id)}`} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#4c805a] hover:underline">Verify this credential <ExternalLink size={11} /></Link><div className="flex gap-2"><button onClick={copy} className="inline-flex items-center gap-2 rounded-full border border-[#dfe8e1] px-4 py-2.5 text-[11px] font-semibold text-[#4a7257] hover:bg-[#f3faf4]"><Copy size={13} />{copied ? "Copied" : "Copy link"}</button><button onClick={share} className="primary-glow inline-flex items-center gap-2 rounded-full bg-[#1d3d2e] px-4 py-2.5 text-[11px] font-semibold text-white hover:bg-[#28523d]">{shared ? <Check size={13} /> : <ExternalLink size={13} />}{shared ? "Shared" : "Share"}</button></div></div>
      </div>
    </div>}
    <p className="mt-6 text-center text-[10px] text-[#99a39b]"><Link to="/dashboard" className="hover:text-[#4c805a]">Back to hiring dashboard</Link></p>
  </main></PageFrame>;
}

export default function App() {
  const location = useLocation();
  const [settledLocationKey, setSettledLocationKey] = useState<string | null>(null);
  const [journey, setJourney] = useState<AssessmentJourney>(emptyAssessmentJourney);
  const startSingle = useCallback((track: AssessmentTrack) => {
    setJourney({ journeyId: null, tracks: [track], currentIndex: 0, profile: null, active: true, scores: {} });
  }, []);
  const startFull = useCallback(() => {
    setJourney({ journeyId: crypto.randomUUID(), tracks: ["problem-solver", "skill", "adapt"], currentIndex: 0, profile: null, active: true, scores: {} });
  }, []);
  const rememberProfile = useCallback((profile: AssessmentProfile) => {
    setJourney((current) => ({ ...current, profile }));
  }, []);
  const advance = useCallback((completedTrack: AssessmentTrack, score: number) => {
    const nextIndex = journey.currentIndex + 1;
    if (nextIndex >= journey.tracks.length) {
      setJourney((current) => ({ ...current, scores: { ...current.scores, [completedTrack]: score } }));
      return null;
    }
    const nextTrack = journey.tracks[nextIndex];
    setJourney((current) => ({ ...current, currentIndex: nextIndex, scores: { ...current.scores, [completedTrack]: score } }));
    return nextTrack;
  }, [journey.currentIndex, journey.tracks]);
  const assessmentFlow = useMemo(() => ({
    journey,
    startSingle,
    startFull,
    rememberProfile,
    advance,
  }), [advance, journey, rememberProfile, startFull, startSingle]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledLocationKey(location.key), 1500);
    return () => window.clearTimeout(timer);
  }, [location.key]);

  return <>
    <ScrollEffects />
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.key}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <AssessmentFlowContext.Provider value={assessmentFlow}>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/assessments" element={<AssessmentHub />} />
            <Route path="/assessments/full" element={<FullAssessmentRoute />} />
            <Route path="/assessments/full/results/:id" element={<FullAssessmentReport />} />
            <Route path="/assessments/result/:id" element={<TrackResultScreen />} />
            <Route path="/assessments/:track" element={<AssessmentTrackRoute />} />
            <Route path="/assessment" element={<Navigate to="/assessments" replace />} />
            <Route path="/assessment/*" element={<Navigate to="/assessments" replace />} />
            <Route path="/viva/:id" element={<Viva />} />
            <Route path="/live-check/:id" element={<LiveCheckChallenge />} />
            <Route path="/hr" element={<Dashboard />} />
            <Route path="/dashboard" element={<Navigate to="/hr" replace />} />
            <Route path="/verify" element={<Verification />} />
            <Route path="/candidates/:id" element={<CandidateDetail />} />
            <Route path="/credential/:id" element={<Credential />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AssessmentFlowContext.Provider>
      </motion.div>
    </AnimatePresence>
    <AnimatePresence>
      {settledLocationKey !== location.key && <LoadingScreen key={location.key} />}
    </AnimatePresence>
  </>;
}
