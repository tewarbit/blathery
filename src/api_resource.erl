-module(api_resource).
-export([init/1, allowed_methods/2, content_types_provided/2, process_post/2, content_types_accepted/2, to_json/2, from_json/2]).

-include_lib("webmachine/include/webmachine.hrl").

init([]) -> {ok, undefined}.

allowed_methods(RD, Ctx) ->
  {['GET', 'POST', 'HEAD'], RD, Ctx}.

content_types_provided(RD, Ctx) ->
  {[ {"application/json", to_json} ], RD, Ctx}.

content_types_accepted(RD, Ctx) ->
  {[{"application/json", from_json}], RD, Ctx}.

process_post(RD, Ctx) ->
  A = wrq:req_body(RD),
  io:format("******** Got the req_body from the ReqData: ~p~n", [A]),

  B = mochiweb_util:parse_qs(A),
  io:format("******** Parsed qs using mochiweb_util: ~p~n", [B]),
  [{JsonDoc, _}] = B,

  {struct, Doc} = mochijson2:decode(JsonDoc),
  io:format("The decoded doc is:~n~p~n", [Doc]),
  Sender = proplists:get_value(<<"sender">>, Doc, undefined),
  Message = proplists:get_value(<<"message">>, Doc, undefined),
  io:format("Recieved a message from: ~p with contents: ~p ~n", [Sender, Message]),
  
  Date = calendar:universal_time(),
  message_store:store_message(Date, Sender, Message),

  NewDoc = mochijson2:encode({struct, Doc}),
  Resp = wrq:set_resp_body(NewDoc, RD),
  {true, Resp, Ctx}.

to_json(RD, Ctx) ->
  Messages = message_store:retrieve_messages_before(calendar:universal_time()),
  io:format("Retrieve messages from DB: ~p~n", [Messages]),

  Resp = mochijson2:encode(Messages),

  {Resp, RD, Ctx}.

from_json(ReqData, Ctx) ->
    case wrq:path_info(id, ReqData) of
        undefined ->
            {false, ReqData, Ctx};
        ID ->
            JsonDoc = wrq:req_body(ReqData),
            {struct, Doc} = mochijson2:decode(JsonDoc),
            ReqData2 = wrq:set_resp_body(Doc, ReqData),
            {true, ReqData2, Ctx}
    end.