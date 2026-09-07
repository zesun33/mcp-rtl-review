module missing_reset (
    input  wire       clk,
    input  wire       enable,
    output reg  [3:0] count
);

    // Flaw: no reset — registers power up unknown.
    always @(posedge clk) begin
        if (enable) begin
            count <= count + 4'b0001;
        end
    end

endmodule
