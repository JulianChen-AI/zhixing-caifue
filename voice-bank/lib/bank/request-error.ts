/** Only an explicit HTTP rejection proves that this request did not commit business effects. */
export class BankRequestError extends Error {
 constructor(message:string,public status:number,public code?:string){super(message);this.name='BankRequestError';}
 get rejected(){return this.status>=400&&this.status<500;}
}
