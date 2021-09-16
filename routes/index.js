const express = require("express");
const {createJob, getJob, updateJob, deleteJob, listJobs} = require("../helpers");
const router = express.Router();

router.post("/", listJobs)
/**
 * @swagger
 * /jobs/create:
 *   post:
 *     summary: API endpoint for creating new delivery jobs.
 *     description: Creates a new delivery job. Delivery jobs are assigned with a status to indicate the stage of the delivery process
 *     consumes:
 *     - "application/json"
 *     produces:
 *     - "application/json"
 *     name: "body"
 *     required: true
 *     requestBodies:
 *       $ref: '#/components/requestBodies/createJobRequest
 *     responses:
 *       $ref: '#/components/responses/createJobResponse
 * components:
 *   schemas:
 *     Job:
 *       type: object
 *       properties:
 *         createdAt:
 *           type: date
 *   requestBodies:
 *     createJobRequest:
 *       description: The created job.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Job'
 *   responses:
 *     createJobResponse:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Job'
 */
router.post("/create", createJob)
/**
 * @swagger
 * /jobs/{job_id}:
 *   get:
 *     summary: API endpoint for retrieving a delivery job.
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         description: Unique ID of the job to retrieve.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         ...
 */
router.get("/:job_id", getJob)
/**
 * @swagger
 * /jobs/{job_id}:
 *   patch:
 *     summary: API endpoint for updating details of a delivery job.
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         description: Unique ID of the job to retrieve.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         ...
 */
router.patch("/:job_id", updateJob)
/**
 * @swagger
 * /jobs/{job_id}:
 *   delete:
 *     summary: API endpoint for cancelling a delivery job.
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         description: Unique ID of the job to retrieve.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         ...
 */
router.delete("/:job_id", deleteJob)

module.exports = router;

