/**
 * Simple polling plugin
 * @module GitHub
 */
"use strict";

var async = require('async'),
	emitter = require('events').EventEmitter,
	events = new emitter(),
	GitHubApi = require('github');

var GitHubPolling = function(config, mergeatron) {
	config.api = config.api || {};

    this.events = events;
	this.config = config;
	this.mergeatron = mergeatron;
	this.api = new GitHubApi({
		version: '3.0.0',
		host: config.api.host || null,
		port: config.api.port || null
	});

	this.api.authenticate(config.auth);
};

GitHubPolling.prototype.validateRef = function(payload) {
	this.mergeatron.log.debug('Evaluating event #' + payload.id);

    var self = this;
    this.mergeatron.db.findEvent({ ref: payload.ref, head: payload.head, after: payload.after }, function(err, res) {
        if (err) {
            self.mergeatron.log.error('Error while looking for payload: ' + JSON.stringify(payload));
            return;
        }

        self.mergeatron.log.debug('PAYLOAD BEING VALIDATED: ' + JSON.stringify(payload));

        // exact match for payload found
        if (res) {
            self.mergeatron.log.debug('Event #' + payload.id + ' already logged');
            return;
        }

        if (!self.config.polling_regex) {
            self.mergeatron.log.debug('Logged payload without rules: #' + payload.id);
            self.events.emit('payload_validated', payload);
            return;
        }

        for (var index in self.config.polling_regex) {
            if (payload.ref.match(self.config.polling_regex[index])) {
                self.mergeatron.log.debug('Logged payload with rules: #' + payload.id);
                self.events.emit('payload_validated', payload);
                return;
            }
        }

        self.mergeatron.log.debug('skipped payload #' + payload.id);
    });
};

GitHubPolling.prototype.logPayload = function(payload) {
    var self = this;
    this.mergeatron.log.info('logging payload: ' + JSON.stringify(payload));
    this.mergeatron.db.insertEvent(payload, function(err, res) {
        if (err) {
            self.mergeatron.log.error(err);
            process.exit(1);
        }
        self.mergeatron.emit('events.ref_update', payload);
    });
};

GitHubPolling.prototype.checkEvents = function() {
	var self = this;

	this.mergeatron.log.info('Polling for github events');

	this.config.repos.forEach(function(repo) {
		self.api.events.getFromRepo({ 'user': self.config.user, 'repo': repo }, function(err, repoEvents) {
            if (err) {
                self.mergeatron.log.error('Error fetching events: ' + err);
                return;
            }

            repoEvents.forEach(function(event) {
                // @todo: support more events?
                if ([ 'PushEvent', 'CreateEvent' ].indexOf(event.type) === -1) {
                    return;
                }

                if (event.type === 'CreateEvent' && event.payload.ref_type !== 'branch') {
                    self.mergeatron.log.info('CreateEvent did not have a ref_type === "branch", skipping', null);
                    return;
                }

                self.events.emit('ref_event', event);
            });
        });
	});
};

GitHubPolling.prototype.buildPayload = function(event) {

    var payload = {
        id: event.id,
        repo: event.repo.name.split('/').pop(),
        actor_id: event.actor.id,
        ref: event.payload.ref,
        master_branch: null,
        head: null,
        after: null,
        email: null
    };

    if (event.type === 'CreateEvent') {
        payload.master_branch = event.payload.master_branch;
    }

    if (event.type === 'PushEvent') {
        payload.ref = payload.ref.split('/').pop();
        payload.head = event.payload.before;
        payload.after = event.payload.head;
    }

    var self = this;
    this.mergeatron.db.findMasterEvent(payload.ref, function(err, res) {
        if (err) {
            self.mergeatron.log.error('Error while building payload (event no. ' + event.id + ') from event: ' + err);
            return;
        }

        payload.master_branch = (!res) ? null : res.master_branch;
        self.api.user.getFrom({ id: event.actor.id, user: event.actor.login }, function(err, user) {
            payload.email = user.email;
            self.events.emit('payload_built', payload);
        });
    });
};


GitHubPolling.prototype.setup = function() {
    var self = this;
    async.parallel({
        'github': function() {
            var run_github = function() {
                self.checkEvents();
                setTimeout(run_github, self.config.frequency);
            };

            run_github();
        }
    });
};

exports.init = function(config, mergeatron) {
	var poller = new GitHubPolling(config, mergeatron);
	poller.setup();

    events.on('ref_event', function(event) {
        poller.buildPayload(event);
    });

    events.on('payload_built', function(payload) {
        poller.validateRef(payload);
    });

    events.on('payload_validated', function(payload) {
        poller.logPayload(payload);
    });
};
