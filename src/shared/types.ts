import type { z } from "zod";
import type * as S from "./schemas";

export type MachineSettings = z.infer<typeof S.MachineSettings>;
export type Project = z.infer<typeof S.Project>;
export type Role = z.infer<typeof S.Role>;
export type PermissionProfile = z.infer<typeof S.PermissionProfile>;
export type Stage = z.infer<typeof S.Stage>;
export type Pipeline = z.infer<typeof S.Pipeline>;
export type Automation = z.infer<typeof S.Automation>;
export type Workspace = z.infer<typeof S.Workspace>;
