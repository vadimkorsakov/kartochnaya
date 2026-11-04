const {test,expect,openHome,createDocument}=require('./helpers');

// The native horizontal scrollbar belongs to the scroller's bottom edge;
// the floating tool dock must stay out of that pointer target.
async function expectDockAboveScrollbar(page){
 const g=await page.evaluate(()=>{
  const sc=document.querySelector('#stageScroller'),dock=document.querySelector('.floating-docks');
  const footer=document.querySelector('.stage-status');
  const s=sc.getBoundingClientRect(),d=dock.getBoundingClientRect(),f=footer.getBoundingClientRect();
  const hit=document.elementFromPoint((s.left+s.right)/2,s.bottom-5);
  return {thin:getComputedStyle(sc).scrollbarWidth==='thin',
    visible:getComputedStyle(dock).display!=='none',
    horizontalRoom:sc.scrollWidth-sc.clientWidth,
    verticalRoom:sc.scrollHeight-sc.clientHeight,
    bottomGap:s.bottom-d.bottom,
    footerGap:f.top-s.bottom,topGap:d.top-s.top,
    blocked:Boolean(hit?.closest('.floating-docks'))};
 });
 expect(g.thin).toBe(true);
 expect(g.visible).toBe(true);
 expect(g.horizontalRoom).toBeGreaterThan(20);
 expect(g.verticalRoom).toBeGreaterThan(20);
 expect(g.bottomGap,'leave at least 16 px between the dock and horizontal track edge').toBeGreaterThanOrEqual(16);
 expect(g.footerGap).toBeGreaterThanOrEqual(-2);
 expect(g.topGap).toBeGreaterThan(0);
 expect(g.blocked).toBe(false);
}

test('thin scrollbars and tool dock stay separate at desktop zoom and narrower widths',async({page})=>{
 await page.setViewportSize({width:1360,height:900});
 await openHome(page);
 await createDocument(page,'Scrollbar navigation',520,520);
 await expectDockAboveScrollbar(page);
 const oldZoom=await page.locator('#zoomLabel').textContent();
 await page.keyboard.press('Control+Equal');
 await expect(page.locator('#zoomLabel')).not.toHaveText(oldZoom);
 await expectDockAboveScrollbar(page);
 const delta=await page.locator('#stageScroller').evaluate(node=>{
  const before=node.scrollLeft;node.scrollLeft+=120;return node.scrollLeft-before;
 });
 expect(delta).toBeGreaterThan(50);
 await page.setViewportSize({width:980,height:680});
 await expectDockAboveScrollbar(page);
 await page.locator('.stage-status').evaluate(node=>node.classList.add('has-emergency'));
 await expectDockAboveScrollbar(page);
 await page.locator('.stage-status').evaluate(node=>node.classList.remove('has-emergency'));
});

test('artboard-series scrollbars remain unobstructed by the tool dock',async({page})=>{
 await page.setViewportSize({width:1360,height:900});
 await openHome(page);
 await createDocument(page,'Series scrollbars',450,450);
 await page.locator('#newCardBtn').click();
 await expect(page.locator('#seriesSidebar')).toBeVisible();
 await page.locator('#seriesSidebarAdd').click();
 await page.locator('#seriesCreateBlank').click();
 await expect(page.locator('.series-board')).toHaveCount(1);
 await expectDockAboveScrollbar(page);
});
