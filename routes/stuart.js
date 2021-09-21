const express = require("express");
const { deliveryUpdate } = require("../helpers/stuart");
const router = express.Router();

router.post("/delivery-update", deliveryUpdate)

module.exports = router;

