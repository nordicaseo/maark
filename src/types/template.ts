export interface TemplateSection {
  heading: string;
  level: 1 | 2 | 3;
  description: string;
  optional: boolean;
}

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  suggestedStructure: TemplateSection[];
  targetWordCount: { min: number; max: number };
  defaultTiptapContent: any;
}
