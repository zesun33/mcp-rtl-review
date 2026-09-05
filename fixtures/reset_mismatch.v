module reset_mismatch (
    input  wire       clk,
    input  wire       rst_n,
    input  wire       enable,
    output reg  [3:0] count
);

    // Flaw: negedge rst_n in sensitivity list, but checking if (rst_n)
    always @(posedge clk or negedge rst_n) begin
        if (rst_n) begin
            count <= 4'b0000;
        end else if (enable) begin
            count <= count + 4'b0001;
        end
    end

endmodule
