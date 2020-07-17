window.addEventListener('load', function() {
    console.log(document.title);
    getComment();
});

function showComment(json) {
    for (var i = 0; i < json.length; i++) {
        var date = json[i].date;  
        var poster_name = json[i].poster_name;
        var text = json[i].text;
        var row = document.getElementById('display_comment').insertRow();

        row.insertCell().textContent = date;
        row.insertCell().textContent = poster_name;
        row.insertCell().textContent = text;
    }
}

function getComment() {
    var url = 'https://commpost.on-going.jp/api/v1/comments';
    var method = 'GET';

    fetch(url, {
        method
    }).then(function(data) {
        return data.json();
    }).then(function (json) {
        showComment(json);
   }).catch((err) => {
        console.log(err);
    });
}

function sendComment() {
    var name = document.getElementById("input_name").value;
    var comment = document.getElementById("input_comment").value;
    if (name.length == 0) name = "Anonymous";
    if (comment.length == 0) return;

    var url = 'https://commpost.on-going.jp/api/v1/comments';
    var obj = {
        "article_id": "C473125B302A312049FB4B1E49C53C07", 
        "poster_name": name,
        "text": comment
    };
    var method = 'POST';
    var body = JSON.stringify(obj);
    var headers = {
      'Content-Type': 'application/json'
    };

    fetch(url, {
        method, 
        headers, 
        body
    }).then((data) => {
        return data.json()
    }).then((json) => {
        showComment([json]);
        document.forms['comment_form'].reset();
    }).catch((err) => {
        console.log(err);
    });
}


