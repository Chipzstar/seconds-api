# Job Statuses

## What is a Job?

The Job is the principal object you will have to deal with. You create a Job through the Seconds API so it can be accepted by a courier in order to handle your deliveries.

When you [create-a-job.md](api-reference/jobs/create-a-job.md "mention"), you'll notice it must always contain at least one delivery. Deliveries will go through several status transitions until the Job ends.&#x20;

### List of available Job statuses

| Status      | Description                                                                         |
| ----------- | ----------------------------------------------------------------------------------- |
| NEW         | We've accepted the job and will be assigning it to a driver.                        |
| PENDING     | Your order has been recorded in the courier's system and is searching for a driver. |
| DISPATCHING | A driver has accepted your order and is on their way to the pickup location         |
| EN-ROUTE    | The driver has pickup up the package and is heading to the drop off location.       |
| COMPLETED   | The package was delivered successfully.                                             |
| CANCELLED   | The package won't be delivered as it was cancelled by the client.                   |
