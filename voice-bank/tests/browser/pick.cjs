// Chooses an option in FlowSelect: tap a row when few options, open the popover when many.
async function pick(page,label,value){
 const group=page.getByRole('radiogroup',{name:label,exact:true});
 if(await group.count()){await group.locator(`[data-value="${value}"]`).click();return;}
 await page.getByRole('combobox',{name:label,exact:true}).click();
 await page.locator(`.choice-option[data-value="${value}"]`).click();
}
// Questionnaire rows are indexed because their titles are not stable test inputs.
async function pickAnswer(page,index,value){await page.locator('.flow-questionnaire .choice-list').nth(index).locator(`[data-value="${value}"]`).click();}
async function answerAt(page,index){return page.locator('.flow-questionnaire .choice-list').nth(index).locator('[aria-checked="true"]').getAttribute('data-value');}
module.exports={pick,pickAnswer,answerAt};
