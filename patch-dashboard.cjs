const fs = require('fs');
const path = 'web/components/containers/DashboardContainer.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add nucleusKnowledgeGraph
const oldHook = `  const nucleusAnalysis = useSynthesisNucleus((s) => s.analysis);
  const nucleusProjection = useSynthesisNucleus((s) => s.projection);`;

const newHook = `  const nucleusAnalysis = useSynthesisNucleus((s) => s.analysis);
  const nucleusProjection = useSynthesisNucleus((s) => s.projection);
  const nucleusKnowledgeGraph = useSynthesisNucleus((s) => s.knowledgeGraph);`;

content = content.replace(oldHook, newHook);

// Pass it to SimpleDashboardView
const oldSimple = `<SimpleDashboardView
                    status={status}
                    analysisId={analysisId}
                    videoMetadata={videoMetadata}
                    digest={digest}
                    digestLoading={digestLoading}
                    mappedDigestData={mappedDigestData}
                    graph={graph}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    hasHadVideo={!!(hasHadVideoRef.current || videoMetadata || nucleusAnalysis?.videoId)}
                  />`;

const newSimple = `<SimpleDashboardView
                    status={status}
                    analysisId={analysisId}
                    videoMetadata={videoMetadata}
                    digest={digest}
                    digestLoading={digestLoading}
                    mappedDigestData={mappedDigestData}
                    graph={graph || nucleusKnowledgeGraph || { nodes: [], edges: [] }}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    hasHadVideo={!!(hasHadVideoRef.current || videoMetadata || nucleusAnalysis?.videoId)}
                  />`;

content = content.replace(oldSimple, newSimple);

fs.writeFileSync(path, content);
