(function(){
"use strict";
var canvas=document.getElementById("graph3d");
if(!canvas)return;
var pointers=new Map(),pan={x:0,y:0},lastCentroid=null;
function pointerCentroid(){var vals=[...pointers.values()];if(vals.length<2)return null;return{x:(vals[0].x+vals[1].x)/2,y:(vals[0].y+vals[1].y)/2}}
function clamp(value,limit){return Math.max(-limit,Math.min(limit,value))}
function applyPan(){canvas.style.transform="translate3d("+pan.x.toFixed(1)+"px,"+pan.y.toFixed(1)+"px,0)"}
canvas.addEventListener("pointerdown",function(e){if(e.pointerType==="mouse")return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2)lastCentroid=pointerCentroid()});
canvas.addEventListener("pointermove",function(e){var p=pointers.get(e.pointerId);if(!p)return;p.x=e.clientX;p.y=e.clientY;if(pointers.size<2)return;var next=pointerCentroid();if(!next)return;if(lastCentroid){var limitX=Math.max(160,canvas.clientWidth*.75),limitY=Math.max(160,canvas.clientHeight*.75);pan.x=clamp(pan.x+(next.x-lastCentroid.x),limitX);pan.y=clamp(pan.y+(next.y-lastCentroid.y),limitY);applyPan();e.preventDefault()}lastCentroid=next},{passive:false});
function endPointer(e){pointers.delete(e.pointerId);lastCentroid=pointers.size>=2?pointerCentroid():null}
canvas.addEventListener("pointerup",endPointer);canvas.addEventListener("pointercancel",endPointer);
}());
