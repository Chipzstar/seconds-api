﻿# Introduction

Documentation of access **APIs** to **Seconds Technologies** services

**Seconds is a fully managed delivery service platform through API which you can easily and quickly access a multitude of delivery fleet providers with a single integration.**

Seconds's optimisation engine aggregates and guarantees the best provider for your business on an order to order basis. With our multi-provider aggregation and optimisation engine we are primed to increase your sales conversion by using different routing rules to select the best delivery partner that will be the cheapest, fastest, highest rating or best ETA, depending on your selection. Our smart engine ensures revenue gain with increased number of orders and improved delivery times.

### API workflow

**The flow begins when your customer makes a delivery request or when you create one on the dashboard**

1.  Your customer makes a **delivery request** or you **create** a delivery request
2.  **Delivery information** is passed through to Seconds through our API or dashboard
3.  Seconds **aggregates quotes** from all integrated delivery fleet providers that are within the coverage area of the delivery
4.  Seconds then **optimises fleet selection** based on the selection strategy you select during your account setup such as; lowest price, fastest delivery time, highest fleet rating, etc.
5.  You can track the **status** of the orders directly from the Seconds dashboard

### API use cases

[Untitled](https://www.notion.so/85eb4d95f4964892878f12a425a9cfd2)

# Get Started

A quick overview of end-to-end integration with Seconds delivery service. The Seconds API enables you to instantly connect with a large number of fleet providers and drivers through a single API interface, and programmatically make instant and scheduled delivery jobs.

Through this quick guide you will get:

-   Understand how to use your access credentials to our APIs
-   Understand how the API works
-   Test your integration

### Set up a Seconds account

Setting up your client account at Seconds is a fundamental step for using the services. By creating your account you have access to the `api-key`required for use of services.

During setup, the best strategy and configuration of delivery fleet providers will be chosen.

> We are in beta and our services are with limited access at this time. Contact us at [secondsdelivery@gmail.com](mailto:secondsdelivery@gmail.com) requesting access

### Environments

Before going into production with your service, test your integration with Seconds in our sandbox environment. In this environment the callback is mocked, being possible to validate different scenarios.

| Environment |  API|
|--|--|
| Sandbox | sandbox-api.useseconds.com |
| Production | app.useseconds.com |
