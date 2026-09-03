(function(){
"use strict";
var data=window.__TOTEM_GRAPH_DATA__;
if(!data||!Array.isArray(data.contracts))return;

// Audited against active production repositories on 2026-09-03.
// This viewer layer only corrects/qualifies presentation endpoints; it does not
// create new dependency contracts or change MCP/RAG semantics.
var featureIds={
  "automata-excavation":["totem-automata.feature-3","totem-excavation.feature-1","totem-excavation.feature-2"],
  "villagers-remnant":["totem-villagers.feature-1","totem-villagers.feature-2","totem-remnant.feature-1"],
  "remnant-trinkets":[],
  "automata-remnant":["totem-automata.feature-1","totem-remnant.feature-1","totem-remnant.feature-5"],
  "automata-locksmith":["totem-automata.feature-1","totem-automata.feature-2","totem-automata.feature-3","totem-locksmith.feature-1","totem-locksmith.feature-2","totem-locksmith.feature-3"],
  "remnant-nexus":["totem-remnant.feature-4","totem-nexus.feature-6"],
  "vanilla-automata-observer":["totem-vanilla-tweaks.feature-1","totem-automata.feature-7"],
  "vanilla-nexus-observer":["totem-vanilla-tweaks.feature-1","totem-nexus.feature-1","totem-nexus.feature-2","totem-nexus.feature-4","totem-nexus.feature-5"],
  "vanilla-locksmith-observer":["totem-vanilla-tweaks.feature-1","totem-locksmith.feature-5"],
  "vanilla-villagers-observer":["totem-vanilla-tweaks.feature-1","totem-villagers.feature-3"],
  "vanilla-remnant-observer":["totem-vanilla-tweaks.feature-1","totem-remnant.feature-3"],
  "discord-worker":["totem-discord-bridge.feature-1","totem-discord-bridge.feature-2","totem-discord-bridge.feature-3","totem-discord-bridge.feature-4"],
  "automata-openai":["totem-automata.feature-1","totem-automata.feature-3","totem-automata.feature-6"],
  "event-remnant-death":["totem-remnant.feature-4","totem-discord-bridge.feature-1"],
  "event-nexus-audit":["totem-nexus.feature-1","totem-nexus.feature-6","totem-discord-bridge.feature-1"],
  "event-locksmith-break":["totem-locksmith.feature-4","totem-discord-bridge.feature-1"]
};

var status={
  "remnant-trinkets":"metadata-only",
  "event-remnant-death":"contract-defined"
};

var notes={
  "automata-excavation":"Copper Golem gathering uses Excavation hammer identity and selected-area excavation; combat positioning is unrelated.",
  "villagers-remnant":"Toolsmith work orders, workshop completion, and merchant offers all participate in four-tier Remnant backpack production/sales.",
  "remnant-trinkets":"Current fabric metadata still suggests Trinkets Updated, but the active production tree did not expose a verified Trinkets bridge during this audit; keep the relation at module level.",
  "automata-openai":"LLM rules participate in both sorting/classification and gathering decisions.",
  "event-nexus-audit":"Nexus publishes both public Space Unit updates and death/admin audit events.",
  "event-remnant-death":"Core defines the Remnant death-backpack event contract; current Remnant production publisher was not independently located by repository code search during this audit."
};

data.contracts=data.contracts.map(function(contract){
  var copy=Object.assign({},contract);
  if(Object.prototype.hasOwnProperty.call(featureIds,copy.id))copy.featureIds=featureIds[copy.id].slice();
  if(status[copy.id])copy.implementationStatus=status[copy.id];
  if(notes[copy.id])copy.auditNote=notes[copy.id];
  if(copy.id==="vanilla-nexus-observer"){
    copy.feature="Observer nexus@3";
    copy.protocol=3;
  }
  if(copy.id==="observer:nexus@2"){
    copy.id="observer:nexus@3";
    copy.protocol=3;
    copy.feature="nexus@3";
    copy.variants=["compass","map","management","map_legacy","friends","friends_legacy","registration","registration_legacy"];
    copy.auditNote="Active NexusObserverScreenProvider reports protocolVersion() = 3 and eight production variants.";
  }
  return Object.freeze(copy);
});
window.__TOTEM_GRAPH_DATA__=data;
}());
