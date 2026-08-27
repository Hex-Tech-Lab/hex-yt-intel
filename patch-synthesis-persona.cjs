const fs = require('fs');
const path = 'web/lib/validators/synthesis.ts';
let content = fs.readFileSync(path, 'utf8');

const tolerantId = `const TolerantPersonaId = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const v = val.trim().toLowerCase();
  if (v === "content_creator" || v === "creator") return "creator";
  if (v === "indie_maker" || v === "indiemaker") return "indieMaker";
  if (v === "consultant") return "consultant";
  if (v === "researcher") return "researcher";
  if (v === "product_manager" || v === "productmanager") return "productManager";
  return val;
}, z.enum(["creator", "indieMaker", "consultant", "researcher", "productManager"]));
\nexport const PersonaConfigSchema`;

content = content.replace('export const PersonaConfigSchema', tolerantId);

content = content.replace(/id: z\.enum\(\[\n\s+"creator",\n\s+"indieMaker",\n\s+"consultant",\n\s+"researcher",\n\s+"productManager",\n\s+\]\)/g, 'id: TolerantPersonaId');

fs.writeFileSync(path, content);
