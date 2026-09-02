(function(){
"use strict";
var data=window.__TOTEM_GRAPH_DATA__;
if(!data||!Array.isArray(data.modules))return;
if(Array.isArray(data.features)&&data.features.length>0)return;
data.features=data.modules.flatMap(function(module){
  return (module.featureGroups||[]).map(function(title,index){
    return {id:module.id+".feature-"+(index+1),ownerId:module.id,title:String(title),summary:String(title),softContractIds:[],serviceContractIds:[],eventContractIds:[]};
  });
});
}());
