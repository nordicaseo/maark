import * as pgSchema from './schema-pg';
import * as sqliteSchema from './schema-sqlite';

const schema = process.env.POSTGRES_URL ? pgSchema : sqliteSchema;

export const documents = schema.documents;
export const serpCache = schema.serpCache;
export const analysisSnapshots = schema.analysisSnapshots;
export const users = schema.users;
export const projects = schema.projects;
export const projectMembers = schema.projectMembers;
export const skills = schema.skills;
export const skillParts = schema.skillParts;
export const aiProviders = schema.aiProviders;
export const aiModelConfig = schema.aiModelConfig;
export const documentComments = schema.documentComments;
export const invitations = schema.invitations;
export const keywords = schema.keywords;
export const pages = schema.pages;
export const pageSnapshots = schema.pageSnapshots;
export const pageIssues = schema.pageIssues;
export const auditLogs = schema.auditLogs;
export const alertEvents = schema.alertEvents;
