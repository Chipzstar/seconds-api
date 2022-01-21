---
description: A quick overview of end-to-end integration with Seconds delivery service.
---

# Getting Started

The Seconds API enables you to instantly connect with a large number of fleet providers and drivers through a single API interface, and programmatically make instant and scheduled delivery jobs.

Through this quick guide you will get:

* Understand how to use your access credentials to our APIs
* Understand how the API works
* Test your integration

#### Set up a Seconds account

Setting up your client account at [Seconds](https://app.useseconds.com/signup) is a fundamental step for using the services. By creating your account you have access to the `api-key`required for use of services.

During setup, the best strategy and configuration of delivery fleet providers will be chosen.

> We are in beta and our services are with limited access at this time. Contact us at [chisom@useseconds.com](mailto:chisom@useseconds.com) requesting access

#### Environments

Before going into production with your service, test your integration with Seconds in our sandbox environment. In this environment the callback is mocked, being possible to validate different scenarios.

| Environment | API                    |
| ----------- | ---------------------- |
| Sandbox     | sandbox.useseconds.com |
| Production  | api.useseconds.com     |

#### Authentication

After setting up a seconds account, you will be able to generate an api key through our dashboard. When making request to our endpoints. Please attach the field name "X-Seconds-Api-Key" to the request header passing your api keys as its value.

| Request header name                   | Header value       |
| ------------------------------------- | ------------------ |
| x-seconds-api-key (must be lowercase) | `</YOUR API KEY/>` |

#### Supported Vehicle Types

Our integrated fleet providers offer a range of different transport vehicles. Below is a table of the vehicle types we offer through our API, including the parcel size and parcel weight recommended for each vehicle.

| Vehicle   | 3-Letter Code | Parcel Size (cm)   | Parcel Weight (kg) |
| --------- | ------------- | ------------------ | ------------------ |
| Bicycle   | BIC           | 40cm, 20cm, 15cm   | 8kg                |
| Motorbike | MTB           | 40cm, 30cm, 30cm   | 12kg               |
| Cargobike | CGB           | 60cm, 50cm, 50cm   | 65kg               |
| Car       | CAR           | 60cm, 40cm, 40cm   | 25kg               |
| Small Van | VAN           | 150cm, 120cm, 90cm | 70kg               |
