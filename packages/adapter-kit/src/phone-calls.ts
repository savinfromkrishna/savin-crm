/** A provider definitively rejected a call before dialing. */
export class PhoneCallRequestRejected extends Error {
  constructor(
    message = "The phone call was rejected. Check the number and the provider configuration.",
  ) {
    super(message);
    this.name = "PhoneCallRequestRejected";
  }
}
