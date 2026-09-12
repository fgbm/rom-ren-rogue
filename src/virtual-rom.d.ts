declare module "virtual:rom" {
  import type { Program } from "./rom/ast.ts";
  const program: Program;
  export default program;
}
