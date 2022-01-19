# Events & Webhooks

### What are Webhooks?

Seconds will send your web application/service HTTPS requests after certain events occur - such as when the status of a job changes or for a delivery ETA update. These requests are known as _webhooks_ or _callbacks_.&#x20;

### How to test webhooks?

Seconds webhooks require a publicly accessible URL of some kind i.e. a public HTTPS endpoint. This means that using your local computer for development requires a separate step. You'll need to use separate software to create a publicly-accessible IP address that can pass requests to your local web application server.

#### Ngrok

One freely available tool to create these tunnels is [ngrok](https://ngrok.com). With ngrok, you can have an HTTPS URL (such as https://dc3b6xfb.ngrok.io) that tunnels requests to a web application server running locally on your own computer at a given port.

Simply install ngrok from the above link, and then run a command similar to:

`ngrok http 8080`

Replace 8080 in the above command with the port that your development web server is listening to - common ports are 3000, 4567, 5000, 8000, and 8080.

You will see a display from ngrok similar to the following:

![ngrok](https://twilio-cms-prod.s3.amazonaws.com/images/Screen\_Shot\_2019-04-16\_at\_10.42.18\_AM.width-500.png)

Next to the forwarding label, you will see your new publicly accessible URL. Use that URL when you configure your webhooks with Twilio, and requests will be served from your local computer. Keep the ngrok command open to maintain the same domain name, however, ngrok will expire publicly accessible domain names after a length of time if you are not on a paid subscription plan.
