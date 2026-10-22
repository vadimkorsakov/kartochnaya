// Injected inside the existing editor closure for the Netlify distribution only.
let pwaUpdateOwnsFreeze=false;
installNetlifyPWA({
 async prepare() {
  if(replacementFrozen||projectOperation||zipWorkspaceBusy)throw Error('Дождись завершения текущей операции');
  replacementFrozen=true;pwaUpdateOwnsFreeze=true;
  try {
   mobileV36EndNudge();
   if(v39Pending){clearTimeout(v39Pending.timer);v39Pending=null}
   await zipSavedSnapshot();
   replacementSealed=true;
   clearTimeout(app.saveTimer);app.saveTimer=null;
  } catch(error) {replacementFrozen=false;pwaUpdateOwnsFreeze=false;throw error}
 },
 resume() {if(pwaUpdateOwnsFreeze){replacementSealed=false;replacementFrozen=false;pwaUpdateOwnsFreeze=false}}
});
