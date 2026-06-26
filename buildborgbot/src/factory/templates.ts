import type { z } from "zod";
import {
  AgendadoConfigSchema,
  GENERIC_AGENDADO_CONFIG,
  WORKSHOP_AGENDADO_CONFIG,
} from "./schemas";

type AgendadoConfig = z.infer<typeof AgendadoConfigSchema>;

// Registry de templates de agendado pre-definidos
// Cada template define los steps, identidad, y parametros de scheduling
export const AGENDADO_TEMPLATES: Record<string, AgendadoConfig> = {
  workshop: WORKSHOP_AGENDADO_CONFIG,
  generic: GENERIC_AGENDADO_CONFIG,
};

export function getTemplate(templateId: string): AgendadoConfig | undefined {
  return AGENDADO_TEMPLATES[templateId];
}

export function listTemplates(): { id: string; name: string }[] {
  return Object.entries(AGENDADO_TEMPLATES).map(([id, config]) => ({
    id,
    name: config.business_identity.name,
  }));
}
