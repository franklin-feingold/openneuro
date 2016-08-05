// dependencies ------------------------------------------------------------

import agave         from '../libs/agave';
import sanitize      from '../libs/sanitize';
import scitran       from '../libs/scitran';
import mongo         from '../libs/mongo';
import async         from 'async';
import config        from '../config';
import {ObjectID}    from 'mongodb';
import crypto        from 'crypto';
import archiver      from 'archiver';
import notifications from '../libs/notifications'

let c = mongo.collections;

// models ------------------------------------------------------------------

let models = {
    job: {
        appId:             'string, required',
        appLabel:          'string, required',
        appVersion:        'string, required',
        datasetId:         'string, required',
        datasetLabel:      'stirng, required',
        executionSystem:   'String, required',
        parameters:        'object, required',
        snapshotId:        'string, required',
        userId:            'string, required',
        batchQueue:        'string, required',
        memoryPerNode:     'number, required',
        nodeCount:         'number, required',
        processorsPerNode: 'number, required',
        input:             'string',
    }
};

// handlers ----------------------------------------------------------------

/**
 * Jobs
 *
 * Handlers for job actions.
 */
let handlers = {

    /**
     * GET Apps
     */
    getApps(req, res, next) {
        agave.api.listApps((err, resp) => {
            if (err) {return next(err);}
            let apps = [];
            async.each(resp.body.result, (app, cb) => {
                agave.api.getApp(app.id, (err, resp2) => {
                    if (resp2.body && resp2.body.result) {
                        apps.push(resp2.body.result);
                    }
                    cb();
                });
            }, () => {
                res.send(apps);
            });
        });
    },

    /**
     * POST Job
     */
    postJob(req, res, next) {
        sanitize.req(req, models.job, (err, job) => {
            if (err) {return next(err);}
            scitran.downloadSymlinkDataset(job.snapshotId, (err, hash) => {
                job.datasetHash = hash
                job.parametersHash = crypto.createHash('md5').update(JSON.stringify(job.parameters)).digest('hex');

                c.jobs.findOne({
                    appId:          job.appId,
                    datasetHash:    job.datasetHash,
                    parametersHash: job.parametersHash,
                    snapshotId:     job.snapshotId
                }, {}, (err, existingJob) => {
                    if (err){return next(err);}
                    if (existingJob) {
                        // allow retrying failed jobs
                        if (existingJob.agave && existingJob.agave.status === 'FAILED') {
                            handlers.retry({params: {jobId: existingJob.jobId}}, res, next);
                            return;
                        }
                        let error = new Error('A job with the same dataset and parameters has already been run.');
                        error.http_code = 409;
                        return next(error);
                    }

                    agave.submitJob(job, (err, resp) => {
                        if (err) {return next(err);}
                        res.send(resp);
                    });
                });
            }, {snapshot: true});
        });
    },

    /**
     * Retry
     */
    retry (req, res, next) {
        let jobId = req.params.jobId;

        // find job
        c.jobs.findOne({jobId}, {}, (err, job) => {
            if (err){return next(err);}
            if (!job) {
                let error = new Error('Could not find job.');
                error.http_code = 404;
                return next(error);
            }
            if (job.agave.status && job.agave.status === 'FINISHED') {
                let error = new Error('A job with the same dataset and parameters has already successfully finished.');
                error.http_code = 409;
                return next(error);
            }
            if (job.agave.status && job.agave.status !== 'FAILED') {
                let error = new Error('A job with the same dataset and parameters is currently running.');
                error.http_code = 409;
                return next(error);
            }

            // re-submit job with old job data
            agave.submitJob(job, (err, resp) => {
                if (err) {
                    return next(err)
                } else {
                    // delete old job
                    c.jobs.removeOne({jobId}, {}, (err, doc) => {
                        if (err) {return next(err);}
                        res.send(resp);
                    });
                }
            });
        });
    },

    /**
     *  GET Dataset Jobs
     */
    getDatasetJobs(req, res, next) {
        let snapshot   = req.query.hasOwnProperty('snapshot') && req.query.snapshot == 'true';
        let datasetId  = req.params.datasetId;
        let user       = req.user;

        scitran.getProject(datasetId, (err, resp) => {
            if (resp.body.code && resp.body.code == 404) {
                let error = new Error(resp.body.detail);
                error.http_code = 404;
                return next(error);
            }

            let hasAccess = !!resp.body.public || req.isSuperUser;
            if (resp.body.permissions && !hasAccess) {
                for (let permission of resp.body.permissions) {
                    if (permission._id == user) {hasAccess = true; break;}
                }
            }


            let query = snapshot ? {snapshotId: datasetId} : {datasetId};
            c.jobs.find(query).toArray((err, jobs) => {
                if (err) {return next(err);}
                if (snapshot) {
                    if (!hasAccess) {
                        let error = new Error('You do not have access to view jobs for this dataset.');
                        error.http_code = 403;
                        return next(error);
                    }
                    // remove user ID on public requests
                    if (!user) {
                        for (let job of jobs) {delete job.userId;}
                    }
                    res.send(jobs);
                } else {
                    scitran.getProjectSnapshots(datasetId, (err, resp) => {
                        let snapshots = resp.body;
                        let filteredJobs = [];
                        for (let job of jobs) {
                            for (let snapshot of snapshots) {
                                if ((snapshot.public || hasAccess) && (snapshot._id === job.snapshotId)) {
                                    if (!user) {delete job.userId;}
                                    filteredJobs.push(job);
                                }
                            }
                        }
                        res.send(filteredJobs);
                    });
                }
            });

        }, {snapshot});
    },

    /**
     * POST Results
     */
    postResults(req, res) {
        let jobId = req.params.jobId;
        c.jobs.findOne({jobId}, {}, (err, job) => {
            if (!job) {
                // occasionally result webhooks callback before the
                // original job submission is saved, in these cases
                // do nothing.
                res.send({});
            } else if (req.body.status === job.agave.status) {
                res.send(job);
            } else if (req.body.status === 'FINISHED' || req.body.status === 'FAILED') {
                agave.getOutputs(jobId, (results) => {
                    c.jobs.updateOne({jobId}, {$set: {agave: req.body, results}}, {}).then((err, result) => {
                        if (err) {res.send(err);}
                        else {res.send(result);}
                        job.agave = req.body;
                        job.results = results;
                        notifications.jobComplete(job);
                    });
                });
            } else {
                c.jobs.updateOne({jobId}, {$set: {agave: req.body}}, {}, (err, result) => {
                    if (err) {res.send(err);}
                    else {res.send(result);}
                });
            }
        });
    },

    /**
     * GET Job
     */
    getJob(req, res) {
        let jobId = req.params.jobId;
        c.jobs.findOne({jobId}, {}, (err, job) => {
            let status = job.agave.status;

            // check if job is already known to be completed
            if ((status === 'FINISHED' && job.results && job.results.length > 0) || status === 'FAILED') {
                res.send(job);
            } else {
                agave.api.getJob(jobId, (err, resp) => {
                    // check status
                    if (resp.body.result.status === 'FINISHED') {
                        job.agave = resp.body.result;
                        agave.getOutputs(jobId, (results) => {
                            c.jobs.updateOne({jobId}, {$set: {agave: resp.body.result, results}}, {}, (err, result) => {
                                if (err) {res.send(err);}
                                else {res.send({agave: resp.body.result, results, snapshotId: job.snapshotId});}
                                job.results = results;
                                if (status !== 'FINISHED') {notifications.jobComplete(job);}
                            });
                        });
                    } else if (job.agave.status !== resp.body.result.status) {
                        job.agave = resp.body.result;
                        c.jobs.updateOne({jobId}, {$set: {agave: resp.body.result}}, {}, (err, result) => {
                            if (err) {res.send(err);}
                            else {res.send({agave: resp.body.result, snapshotId: job.snapshotId});}
                            if (resp.body.result.status === 'FAILED') {
                                notifications.jobComplete(job);
                            }
                        });
                    } else {
                        res.send({agave: resp.body.result, snapshotId: job.snapshotId});
                    }
                });
            }
        });
    },

    /**
     * GET Download Ticket
     */
    getDownloadTicket(req, res, next) {
        let jobId    = req.params.jobId,
            filePath = req.query.filePath,
            fileName = filePath.split('/')[filePath.split('/').length - 1];
        c.jobs.findOne({jobId}, {}, (err, job) => {
            if (err){return next(err);}
            if (!job) {
                let error = new Error('Could not find job.');
                error.http_code = 404;
                return next(error);
            }
            scitran.getProject(job.snapshotId, (err, resp) => {
                let hasPermission;
                if (!req.user) {
                    hasPermission = false;
                } else {
                    for (let permission of resp.body.permissions) {
                        if (req.user === permission._id) {
                            hasPermission = true;
                            break;
                        }
                    }
                }
                if (resp.body.public || hasPermission) {
                    let ticket = {
                        type: 'download',
                        userId: req.user,
                        jobId: jobId,
                        fileName: fileName,
                        filePath: filePath,
                        created: new Date()
                    };
                    // Create and return token
                    c.tickets.insertOne(ticket, (err) => {
                        if (err) {return next(err);}
                        c.tickets.ensureIndex({created: 1}, {expireAfterSeconds: 60}, () => {
                            res.send(ticket);
                        });
                    });
                } else {
                    let error = new Error('You do not have permission to access this file.');
                    error.http_code = 403;
                    return next(error);
                }
            }, {snapshot: true});
        });
    },

    /**
     * GET File
     */
    getFile(req, res, next) {
        let ticket   = req.query.ticket,
            fileName = req.params.fileName,
            jobId    = req.params.jobId;

        if (!ticket) {
            let error = new Error('No download ticket query parameter found.');
            error.http_code = 400;
            return next(error);
        }

        c.tickets.findOne({_id: ObjectID(ticket), type: 'download', fileName: fileName, jobId: jobId}, {}, (err, result) => {
            if (err) {return next(err);}
            if (!result) {
                let error = new Error('Download ticket was not found or expired');
                error.http_code = 401;
                return next(error);
            }

            let path = result.filePath;

            if (path === 'all') {

                // initialize archive
                let archive = archiver('zip');

                // log archiving errors
                archive.on('error', (err) => {
                    console.log('archiving error - job: ' + jobId);
                    console.log(err);
                });

                c.jobs.findOne({jobId}, {}, (err, job) => {
                    // set archive name
                    res.attachment(job.appId + '-results.zip');

                    // begin streaming archive
                    archive.pipe(res);

                    async.eachSeries(job.results, (result, cb) => {
                        path = 'jobs/v2/' + jobId + '/outputs/media' + result.path;
                        let name = result.name;

                        agave.api.getPath(path, (err, res, token) => {
                            let body = res.body;
                            if (!body || (body.status && body.status === 'error')) {
                                // error from AGAVE
                            } else {
                                // stringify JSON
                                if (typeof body === 'object' && !Buffer.isBuffer(body)) {
                                    body = JSON.stringify(body);
                                }
                                // append file to archive
                                archive.append(body, {name: name});
                            }

                            cb();
                        });
                    }, () =>{
                        archive.finalize();
                    });
                });
            } else {
                // download individual file
                path = 'jobs/v2/' + jobId + '/outputs/media' + path;
                agave.api.getPathProxy(path, res);
            }
        });

    },

    /**
     * DELETE Dataset Jobs
     *
     * Takes a dataset ID url parameter and deletes all jobs for that dataset.
     */
    deleteDatasetJobs(req, res, next) {
        let datasetId = req.params.datasetId;

        scitran.getProject(datasetId, (err, resp) => {
            if (resp.statusCode == 400) {
                let error = new Error('Bad request');
                error.http_code = 400;
                return next(error);
            }
            if (resp.statusCode == 404) {
                let error = new Error('No dataset found');
                error.http_code = 404;
                return next(error);
            }

            let hasPermission;
            if (!req.user) {
                hasPermission = false;
            } else {
                for (let permission of resp.body.permissions) {
                    if (req.user === permission._id && permission.access === 'admin') {
                        hasPermission = true;
                        break;
                    }
                }
            }
            if (!resp.body.public && hasPermission) {
                c.jobs.deleteMany({datasetId}, [], (err, doc) => {
                    if (err) {return next(err);}
                    res.send({message: doc.result.n + ' job(s) have been deleted for dataset ' + datasetId});
                });
            } else {
                let message = resp.body.public ? 'You don\'t have permission to delete results from public datasets' : 'You don\'t have permission to delete jobs from this dataset.';
                let error = new Error(message);
                error.http_code = 403;
                return next(error);
            }
        });
    }

};

export default handlers;