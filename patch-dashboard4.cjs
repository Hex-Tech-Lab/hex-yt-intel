const fs = require('fs');
const path = 'web/components/containers/DashboardContainer.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldSimple = `                {effectiveViewMode === "simple" ? (
                  <SimpleDashboardView
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
                  />
                ) : (`;

const newSimple = `                {effectiveViewMode === "simple" ? (() => {
                  const simpleViewGraph = (graph && graph.nodes && graph.nodes.length > 0)
                    ? graph
                    : (nucleusKnowledgeGraph && nucleusKnowledgeGraph.nodes && nucleusKnowledgeGraph.nodes.length > 0)
                      ? nucleusKnowledgeGraph
                      : { nodes: [], edges: [] };
                  
                  return (
                    <SimpleDashboardView
                      status={status}
                      analysisId={analysisId}
                      videoMetadata={videoMetadata}
                      digest={digest}
                      digestLoading={digestLoading}
                      mappedDigestData={mappedDigestData}
                      graph={simpleViewGraph as any}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={handleSelectNode}
                      hasHadVideo={!!(hasHadVideoRef.current || videoMetadata || nucleusAnalysis?.videoId)}
                    />
                  );
                })() : (`;

content = content.replace(oldSimple, newSimple);
fs.writeFileSync(path, content);
