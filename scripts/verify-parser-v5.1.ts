import { parseUCISSections } from '../web/lib/utils/ucis-parser';

const mockMarkdown = `
### DIMENSION 1 – APEX INTELLIGENCE
Content for dimension 1.

### DIMENSION 2 – PROVENANCE & METADATA
Content for dimension 2.

### DIMENSION 3 – CONTENT ARCHITECTURE
Content for dimension 3.

### DIMENSION 4 – PSYCHOLOGICAL LAYER
Content for dimension 4.

### DIMENSION 5 – CORE INTELLIGENCE
Content for dimension 5.

### DIMENSION 6 – QUANTITATIVE ANALYSIS
Content for dimension 6.

### DIMENSION 7 – IMPLEMENTATION SYSTEMS
Content for dimension 7.

### DIMENSION 8 – SEMANTIC FOUNDATION
Content for dimension 8.

### DIMENSION 9 – FORWARD FORESIGHT
Content for dimension 9.

### DIMENSION 10 – CREDIBILITY & RISK
Content for dimension 10.

### DIMENSION 11 – COMMERCIAL YIELD
Content for dimension 11.
`;

function verify() {
  console.log('🚀 Verifying UCIS v5.1 Parser...');
  const sections = parseUCISSections(mockMarkdown);
  
  const expected = [
    'apex', 'provenance', 'architecture', 'psychological', 'coreIntelligence',
    'comparative', 'implementation', 'semantic', 'forward', 'credibility', 'monetization'
  ];

  let errors = 0;
  expected.forEach((key, index) => {
    const val = (sections as any)[key];
    if (val === 'Parsing...') {
      console.error(`❌ Dimension ${index + 1} (${key}) failed to parse.`);
      errors++;
    } else {
      console.log(`✅ Dimension ${index + 1} (${key}) parsed: "${val}"`);
    }
  });

  if (errors === 0) {
    console.log('✨ All 11 dimensions verified successfully.');
  } else {
    console.error(`💥 Verification failed with ${errors} errors.`);
    process.exit(1);
  }
}

verify();
