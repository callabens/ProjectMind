import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectMindDir, type IntentContract, type ProjectConfig } from "../../core/src/index.ts";
import { loadConfig } from "../../core/src/project.ts";
import { loadIntent } from "../../intent/src/index.ts";

export type DoctorSeverity = "error" | "warning" | "info";

export interface DoctorDiagnostic {
  code: string;
  severity: DoctorSeverity;
  message: string;
  remedy?: string;
}

export interface DoctorReport {
  status: "READY" | "NEEDS_ATTENTION";
  projectRoot: string;
  projectName?: string;
  intentId?: string;
  diagnostics: DoctorDiagnostic[];
}

function inspectConfig(config: ProjectConfig): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  if (!config.verification.commands.length) {
    diagnostics.push({ code: "NO_VERIFICATION_COMMANDS", severity: "error", message: "No verification commands are configured.", remedy: "Add reviewed commands to .projectmind/config.json." });
    return diagnostics;
  }
  if (!config.verification.commands.some((item) => item.required)) diagnostics.push({
    code: "NO_REQUIRED_COMMANDS", severity: "error", message: "No configured verification command is required.", remedy: "Mark at least one reviewed verification command as required.",
  });
  if (!config.verification.commands.some((item) => item.provider === "node-test-junit" || item.provider === "pytest-junit")) diagnostics.push({
    code: "NO_STRUCTURED_TEST_PROVIDER", severity: "warning", message: "No structured test provider can prove exact testcase bindings.", remedy: "Configure a node-test-junit or pytest-junit command for test requirements.",
  });
  return diagnostics;
}

function inspectIntent(intent: IntentContract, config: ProjectConfig): DoctorDiagnostic[] {
  const diagnostics: DoctorDiagnostic[] = [];
  const configured = new Set(config.verification.commands.map((item) => item.command));
  if (!intent.requirements.length) diagnostics.push({ code: "NO_REQUIREMENTS", severity: "error", message: `Intent ${intent.id} has no requirements.` });
  for (const requirement of intent.requirements) {
    if (!requirement.evidenceCommands?.length) {
      diagnostics.push({ code: "UNBOUND_REQUIREMENT", severity: "error", message: `${requirement.id} is not bound to a verification command.`, remedy: `Run projectmind intent suggest ${requirement.id}, then explicitly bind a reviewed candidate.` });
      continue;
    }
    for (const command of requirement.evidenceCommands) if (!configured.has(command)) diagnostics.push({
      code: "UNDECLARED_BOUND_COMMAND", severity: "error", message: `${requirement.id} references a command absent from .projectmind/config.json: ${command}`, remedy: "Restore the reviewed command or update the explicit requirement binding.",
    });
    if (requirement.evidenceKinds.includes("test") && !requirement.evidenceTests?.length) diagnostics.push({
      code: "MISSING_TESTCASE_BINDING", severity: "error", message: `${requirement.id} requires test evidence but has no exact testcase binding.`, remedy: `Bind one or more exact testcase names for ${requirement.id}.`,
    });
    if (requirement.coveragePaths?.length && !requirement.evidenceCommands.some((command) =>
      config.verification.commands.some((item) => item.command === command && item.coveragePath))) diagnostics.push({
      code: "COVERAGE_COMMAND_MISSING", severity: "error", message: `${requirement.id} declares coverage paths but none of its commands produces LCOV evidence.`, remedy: "Configure coveragePath on a bound verification command.",
    });
  }
  if (!intent.preserve.length && !intent.outOfScope.length) diagnostics.push({ code: "NO_SCOPE_DECLARATIONS", severity: "info", message: `Intent ${intent.id} has no preserve or out-of-scope declarations.` });
  return diagnostics;
}

export async function diagnoseProject(rootInput: string): Promise<DoctorReport> {
  const root = resolve(rootInput);
  if (!existsSync(join(projectMindDir(root), "config.json"))) return {
    status: "NEEDS_ATTENTION", projectRoot: root,
    diagnostics: [{ code: "NOT_INITIALIZED", severity: "error", message: "ProjectMind is not initialized in this repository.", remedy: "Run projectmind init." }],
  };

  let config: ProjectConfig;
  try {
    config = await loadConfig(root);
  } catch (error) {
    return {
      status: "NEEDS_ATTENTION", projectRoot: root,
      diagnostics: [{ code: "INVALID_CONFIG", severity: "error", message: `ProjectMind configuration is invalid: ${error instanceof Error ? error.message : String(error)}`, remedy: "Repair .projectmind/config.json and run doctor again." }],
    };
  }

  const diagnostics = inspectConfig(config);
  let intent: IntentContract | undefined;
  try {
    intent = await loadIntent(root);
    diagnostics.push(...inspectIntent(intent, config));
  } catch (error) {
    diagnostics.push({ code: "NO_ACTIVE_INTENT", severity: "error", message: `No valid active intent is available: ${error instanceof Error ? error.message : String(error)}`, remedy: "Create an intent or repair .projectmind/current-intent.json." });
  }

  return {
    status: diagnostics.some((item) => item.severity === "error") ? "NEEDS_ATTENTION" : "READY",
    projectRoot: root, projectName: config.project.name, ...(intent ? { intentId: intent.id } : {}), diagnostics,
  };
}
