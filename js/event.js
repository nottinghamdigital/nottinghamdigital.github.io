



/**
 * Usage
 *
 * var eventApi = new ndEvent("http://notts-digital.pavlakis.info/index.php");
 * eventApi.load(groupsArray);
 * eventApi.getByGroup("PHPMinds");
 *
 * Note: Dealing with async events. Wrap around $(document).ajaxStop(function(){}); or use Promises
 */


var ndEvent = function (args){
    this.apiUrl = args.api;
    this.events = [];
   
    if (!window.localStorage) {
        this.cache = false;
    } else {
        this.cache = window.localStorage;
        this.refreshCache();
    }
};

ndEvent.prototype.renderEvents = function(groupNodes) {

        var self = this 
        $.ajax(); // dummy workaround for ajaxStop to always fire
        $(document).ajaxStop(function(){
        groupNodes.each(function(index, node){
            
            var groupName = $.trim($(node).html());

            if(self.getByGroup(groupName) && self.getByGroup(groupName).group) {

                var data = self.getByGroup(groupName);
                $(node).parent().parent().append('<span><i class="fa fa-calendar"></i> <a href="' + data.event_url + '">' + data.date_time + '</a> </span>');
            }

        });
    });
    
};


ndEvent.prototype.getByGroup = function(groupName){

    if (!this.isCached(groupName)) {
        this.fetchGroup(groupName);
    }

    return this.getEvent(groupName);

};

ndEvent.prototype.fetchGroup = function(groupName){
    var thisScope = this;

    $.ajax(
        {
            method: "GET",
            url: this.apiUrl,
            data: {group: groupName}
        }
    ).done(function(data) {
        if(data) {
            thisScope.addEvent(groupName, data);
        }
    });
};

ndEvent.prototype.addEvent = function(groupName, data) {
    if (this.cache) {
        if (!this.isCached(groupName)) {
            this.cache.setItem(groupName, JSON.stringify(data));
        }
    } else {
        this.events[groupName] = JSON.stringify(data);
    }
};

ndEvent.prototype.getEvent = function(groupName) {
    if (!this.cache) {
        if (groupName in this.events) {
            return this.events[groupName];
        }
    }

    return this.getFromCache(groupName);
};

ndEvent.prototype.isCached = function(groupName) {

    if (!this.cache) {
        if (groupName in this.events) {
            return true;
        }
        return false;
    }

    if (!this.cache.getItem(groupName)) {
        return false;
    }

    return true;
};

ndEvent.prototype.getFromCache = function(groupName) {
    if (this.isCached(groupName)) {
        return JSON.parse(this.cache.getItem(groupName));
    }
}

// tomorrow's calculation taken from SO link: http://stackoverflow.com/questions/9444745/javascript-how-to-get-tomorrows-date-in-format-dd-mm-yy
ndEvent.prototype.refreshCache = function() {
  if (!this.cache) {
      return false;
  }

  if (this.cache.getItem('expiry')) {
      // reset if more than 24 hours
      if (new Date() > this.cache.getItem('expiry')) {
          this.cache.clear();
          this.cache.setItem('expiry', new Date(new Date().getTime() + 24 * 60 * 60 * 1000));
      }
  } else {
      this.cache.setItem('expiry', new Date(new Date().getTime() + 24 * 60 * 60 * 1000));
  }
};

ndEvent.prototype.load = function (groupsArray) {

    var thisScope = this;

    groupsArray.forEach(function(groupName){
        thisScope.getByGroup(groupName);
    });
};


/**
    Initialisation code 
**/


(function($){

    var arguments = {
          "api":"http://notts-digital.pavlakis.info/index.php",
          
      }
        var eventApi = new ndEvent(arguments),
            groupNodes = $('.vcard a'),
            groups = groupNodes.map(function(){
                return $.trim($(this).text());
            }).get();

        eventApi.load(groups);


        eventApi.renderEvents(groupNodes);
       

   })(jQuery);
