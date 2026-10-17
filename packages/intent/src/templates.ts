import type { EvidenceKind, IntentContract } from "../../core/src/index.ts";
import { createIntent } from "./index.ts";

export interface IntentTemplate {
  id: string;
  title: string;
  description: string;
  requirements: string[];
  preserve: string[];
  outOfScope: string[];
  evidenceKinds: EvidenceKind[];
}

const templates: IntentTemplate[] = [
  {
    id: "authentication-regression",
    title: "Preserve authentication behavior",
    description: "Protect successful login, rejection behavior and session lifecycle with exact tests.",
    requirements: ["Valid credentials authenticate successfully", "Invalid credentials are rejected", "Session creation and logout behavior remain functional"],
    preserve: ["Existing authentication trust boundaries and credential handling"],
    outOfScope: ["Authentication UI redesign and unrelated account features"],
    evidenceKinds: ["test"],
  },
  {
    id: "api-contract",
    title: "Preserve the public API contract",
    description: "Guard successful responses, invalid-input behavior and documented error shapes.",
    requirements: ["Successful API responses remain contract compatible", "Malformed requests are rejected by validated input boundaries", "Documented error responses remain contract compatible"],
    preserve: ["Published request and response compatibility"],
    outOfScope: ["Undocumented internal implementation details"],
    evidenceKinds: ["test"],
  },
  {
    id: "dependency-boundary",
    title: "Preserve architecture dependency boundaries",
    description: "Guard reviewed package direction and sensitive architecture paths with static evidence.",
    requirements: ["Forbidden dependency directions are not introduced", "Sensitive architecture files satisfy declared policy checks"],
    preserve: ["Reviewed module ownership and dependency direction"],
    outOfScope: ["Unrelated formatting and documentation changes"],
    evidenceKinds: ["static"],
  },
];

export function listIntentTemplates(): IntentTemplate[] {
  return templates.map((template) => ({ ...template, requirements: [...template.requirements], preserve: [...template.preserve], outOfScope: [...template.outOfScope], evidenceKinds: [...template.evidenceKinds] }));
}

export async function createIntentFromTemplate(
  root: string,
  templateId: string,
  options: { title?: string; requirements?: string[]; preserve?: string[]; outOfScope?: string[] } = {},
): Promise<IntentContract> {
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown intent template: ${templateId}`);
  return createIntent(
    root,
    options.title ?? template.title,
    [...template.requirements, ...(options.requirements ?? [])],
    [...template.preserve, ...(options.preserve ?? [])],
    [...template.outOfScope, ...(options.outOfScope ?? [])],
    template.evidenceKinds,
  );
}
