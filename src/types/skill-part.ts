export const SKILL_PART_TYPES = [
  { value: 'brand_voice', label: 'Brand Voice', description: 'Tone, personality, language patterns' },
  { value: 'technical_details', label: 'Technical Details', description: 'Product/service specifics' },
  { value: 'brand_history', label: 'Brand History', description: 'Background, values, mission' },
  { value: 'content_structure', label: 'Content Structure', description: 'Outline templates, section order' },
  { value: 'keywords', label: 'Keyword Guidelines', description: 'How to integrate keywords' },
  { value: 'tone_guidelines', label: 'Tone Guidelines', description: 'Formal/casual, audience targeting' },
  { value: 'custom', label: 'Custom', description: 'Free-form instructions' },
] as const;

export type SkillPartType = (typeof SKILL_PART_TYPES)[number]['value'];

export interface SkillPart {
  id: number;
  skillId: number;
  partType: SkillPartType;
  label: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
